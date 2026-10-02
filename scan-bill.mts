// Reads a photo (or PDF) of a grocery bill with Claude via Netlify AI Gateway and returns the line items as JSON.
// Nothing is saved here; the app shows the result for the user to check before adding it to their spending.
const UNITS = ["kg", "g", "L", "ml", "pcs"]
const CATS = ["Vegetables", "Fruits", "Grains", "Dairy", "Grocery", "Meat & fish", "Household"]
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]

const TOOL = {
  name: "record_bill",
  description: "Record every purchased line item read from the grocery bill.",
  input_schema: {
    type: "object",
    properties: {
      store: { type: "string", description: "Shop name printed on the bill, or empty string if not visible" },
      date: { type: "string", description: "Bill date as YYYY-MM-DD, or empty string if not visible" },
      total: { type: "number", description: "Final amount payable printed on the bill (after discounts and taxes), or 0 if not visible" },
      payment: { type: "string", enum: ["Cash", "UPI", "Card", ""], description: "Payment mode if printed, else empty string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Short, readable product name in title case, e.g. 'Toor dal' not 'TOOR DAL LOOSE 1KG'" },
            qty: { type: "number", description: "Quantity bought, expressed in `unit`" },
            unit: { type: "string", enum: UNITS },
            amount: { type: "number", description: "Final line amount paid for this item in rupees, after any item discount" },
            category: { type: "string", enum: CATS },
          },
          required: ["name", "qty", "unit", "amount", "category"],
        },
      },
    },
    required: ["store", "date", "total", "payment", "items"],
  },
}

export default async (req: Request) => {
  if (req.method !== "POST") return Response.json({ error: "Use POST" }, { status: 405 })
  let body: any
  try { body = await req.json() } catch { return Response.json({ error: "Invalid request" }, { status: 400 }) }
  const { data, type, products } = body || {}
  if (typeof data !== "string" || !data || !TYPES.includes(type)) return Response.json({ error: "Upload a JPG, PNG, WEBP or PDF of the bill." }, { status: 400 })
  if (data.length > 5_500_000) return Response.json({ error: "That file is too large. Try a smaller photo." }, { status: 413 })
  const known = Array.isArray(products) ? products.filter((p: unknown) => typeof p === "string").slice(0, 200).map((p: string) => p.slice(0, 40)) : []

  const file = type === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: type, data } }
    : { type: "image", source: { type: "base64", media_type: type, data } }
  const prompt = `This is a grocery shop bill from India (amounts in rupees). Read every purchased line item and call record_bill.
Rules:
- Skip subtotal, tax summary, savings, round-off, and payment lines; only list products bought.
- qty and unit: if the bill shows weight or volume (e.g. 0.750 kg, 500 g, 1 L), use it. If the product name includes a pack size and the bill qty is a count (e.g. "SUGAR 1KG" x 2), give the total weight/volume (2 kg). Otherwise use the count with unit "pcs". Prefer kg or L over g or ml once the amount is 1000 or more.
- amount is the final amount charged for that line.
- If an item clearly matches one of these known products, use that exact name: ${known.join(", ") || "(none)"}.
- If something is unreadable, give your best guess; the user checks everything before saving.`

  const key = process.env.ANTHROPIC_API_KEY
  const base = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "")
  if (!key) return Response.json({ error: "Bill reading is not available yet on this site." }, { status: 503 })

  try {
    const r = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "record_bill" },
        messages: [{ role: "user", content: [file, { type: "text", text: prompt }] }],
      }),
    })
    if (!r.ok) {
      console.error("AI Gateway error", r.status, (await r.text()).slice(0, 500))
      return Response.json({ error: r.status === 429 ? "Too many bills at once. Wait a minute and try again." : "Could not read the bill. Try again." }, { status: 502 })
    }
    const out = await r.json()
    const use = (out.content || []).find((c: any) => c.type === "tool_use")
    if (!use) return Response.json({ error: "Could not read the bill. Try a clearer photo." }, { status: 422 })
    const b = use.input || {}
    const num = (x: unknown) => (typeof x === "number" && isFinite(x) && x >= 0 ? Math.round(x * 1000) / 1000 : 0)
    const items = (Array.isArray(b.items) ? b.items : []).map((i: any) => ({
      name: String(i.name || "").trim().slice(0, 40),
      qty: num(i.qty) || 1,
      unit: UNITS.includes(i.unit) ? i.unit : "pcs",
      amount: num(i.amount),
      cat: CATS.includes(i.category) ? i.category : "Grocery",
    })).filter((i: any) => i.name)
    return Response.json({
      store: String(b.store || "").trim().slice(0, 40),
      date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : "",
      total: num(b.total),
      pay: ["Cash", "UPI", "Card"].includes(b.payment) ? b.payment : "",
      items,
    })
  } catch (e) {
    console.error(e)
    return Response.json({ error: "Could not read the bill. Check your connection and try again." }, { status: 500 })
  }
}

export const config = { path: "/api/scan-bill" }
