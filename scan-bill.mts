import { createWorker } from "tesseract.js"

const UNITS = ["kg", "g", "L", "ml", "pcs"] as const
const CATS = [
  "Vegetables",
  "Fruits",
  "Grains",
  "Dairy",
  "Grocery",
  "Meat & fish",
  "Household",
] as const

type Unit = typeof UNITS[number]
type Category = typeof CATS[number]

export interface BillItem {
  name: string
  qty: number
  unit: Unit
  amount: number
  cat: Category
}

export interface ParsedBill {
  store: string
  date: string
  total: number
  pay: "" | "Cash" | "UPI" | "Card"
  items: BillItem[]
}

/* -----------------------------
   COMMON GROCERY KEYWORDS
----------------------------- */

const PRODUCT_CATEGORIES: Record<string, Category> = {
  tomato: "Vegetables",
  tomatoes: "Vegetables",
  potato: "Vegetables",
  onion: "Vegetables",
  carrot: "Vegetables",
  beans: "Vegetables",
  brinjal: "Vegetables",
  cabbage: "Vegetables",
  cauliflower: "Vegetables",
  keerai: "Vegetables",
  spinach: "Vegetables",

  apple: "Fruits",
  banana: "Fruits",
  orange: "Fruits",
  grapes: "Fruits",
  mango: "Fruits",
  papaya: "Fruits",
  watermelon: "Fruits",

  rice: "Grains",
  wheat: "Grains",
  atta: "Grains",
  flour: "Grains",
  ragi: "Grains",
  oats: "Grains",
  dal: "Grocery",
  dhal: "Grocery",
  toor: "Grocery",
  moong: "Grocery",
  urad: "Grocery",
  sugar: "Grocery",
  salt: "Grocery",
  oil: "Grocery",
  tea: "Grocery",
  coffee: "Grocery",
  masala: "Grocery",
  biscuit: "Grocery",

  milk: "Dairy",
  curd: "Dairy",
  yogurt: "Dairy",
  butter: "Dairy",
  paneer: "Dairy",
  cheese: "Dairy",

  chicken: "Meat & fish",
  mutton: "Meat & fish",
  fish: "Meat & fish",
  egg: "Meat & fish",
  eggs: "Meat & fish",

  soap: "Household",
  detergent: "Household",
  shampoo: "Household",
  tissue: "Household",
  cleaner: "Household",
}

/* -----------------------------
   NUMBER PARSER
----------------------------- */

function cleanNumber(value: string): number {
  const cleaned = value
    .replace(/₹/g, "")
    .replace(/rs\.?/gi, "")
    .replace(/,/g, "")
    .trim()

  const match = cleaned.match(/\d+(?:\.\d+)?/)

  return match ? Number(match[0]) : 0
}

/* -----------------------------
   CATEGORY DETECTION
----------------------------- */

function detectCategory(name: string): Category {
  const lower = name.toLowerCase()

  for (const keyword of Object.keys(PRODUCT_CATEGORIES)) {
    if (lower.includes(keyword)) {
      return PRODUCT_CATEGORIES[keyword]
    }
  }

  return "Grocery"
}

/* -----------------------------
   PRODUCT NAME CLEANING
----------------------------- */

function cleanProductName(value: string): string {
  let name = value

  // Remove leading item numbers
  name = name.replace(/^\s*\d+[\.\)\-:]?\s*/, "")

  // Remove quantity patterns
  name = name.replace(
    /\b\d+(?:\.\d+)?\s*(kg|kgs|g|gm|gms|l|ltr|litre|litres|ml|pcs|pc)\b/gi,
    ""
  )

  // Remove price at end
  name = name.replace(/\s+\d+(?:\.\d+)?\s*$/g, "")

  // Remove excessive characters
  name = name.replace(/[|*_]+/g, " ")

  name = name.replace(/\s+/g, " ").trim()

  // Title Case
  return name
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .slice(0, 40)
}

/* -----------------------------
   UNIT DETECTION
----------------------------- */

function detectUnit(text: string): Unit {
  const value = text.toLowerCase()

  if (/\bkg\b|\bkgs\b/.test(value)) return "kg"
  if (/\bg\b|\bgm\b|\bgms\b/.test(value)) return "g"
  if (/\bl\b|\bltr\b|\blitre\b|\blitres\b/.test(value)) return "L"
  if (/\bml\b/.test(value)) return "ml"

  return "pcs"
}

/* -----------------------------
   QUANTITY DETECTION
----------------------------- */

function detectQuantity(text: string): number {
  const value = text.toLowerCase()

  const weight = value.match(
    /(\d+(?:\.\d+)?)\s*(kg|kgs|g|gm|gms|l|ltr|litre|litres|ml)\b/i
  )

  if (weight) {
    let qty = Number(weight[1])
    const unit = weight[2].toLowerCase()

    if (["g", "gm", "gms"].includes(unit)) {
      qty = qty / 1000
    }

    if (["ml"].includes(unit)) {
      qty = qty / 1000
    }

    return qty
  }

  // x2 / *2 / qty 2
  const count = value.match(
    /(?:x|\*|qty[:\s]*)\s*(\d+(?:\.\d+)?)/i
  )

  if (count) return Number(count[1])

  return 1
}

/* -----------------------------
   AMOUNT DETECTION
----------------------------- */

function detectAmount(text: string): number {
  const numbers = text
    .replace(/₹/g, " ")
    .replace(/rs\.?/gi, " ")
    .match(/\d+(?:\.\d+)?/g)

  if (!numbers?.length) return 0

  /*
   * Usually the final number on a product
   * line is the selling amount.
   */
  return Number(numbers[numbers.length - 1])
}

/* -----------------------------
   DATE DETECTION
----------------------------- */

function detectDate(text: string): string {
  let match = text.match(
    /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/
  )

  if (!match) return ""

  let day = Number(match[1])
  let month = Number(match[2])
  let year = Number(match[3])

  if (year < 100) year += 2000

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/* -----------------------------
   STORE DETECTION
----------------------------- */

function detectStore(lines: string[]): string {
  const ignore = [
    "invoice",
    "bill",
    "receipt",
    "tax invoice",
    "gst",
    "date",
    "phone",
    "mobile",
    "address",
    "cashier",
  ]

  for (const line of lines.slice(0, 8)) {
    const value = line.trim()

    if (!value) continue

    if (value.length < 3 || value.length > 50) continue

    if (/^\d+$/.test(value)) continue

    const lower = value.toLowerCase()

    if (ignore.some(word => lower.includes(word))) continue

    return cleanProductName(value)
  }

  return ""
}

/* -----------------------------
   PAYMENT DETECTION
----------------------------- */

function detectPayment(text: string): ParsedBill["pay"] {
  const value = text.toLowerCase()

  if (/\bcash\b/.test(value)) return "Cash"

  if (
    /\bupi\b/.test(value) ||
    /phonepe/.test(value) ||
    /gpay/.test(value) ||
    /google pay/.test(value) ||
    /paytm/.test(value)
  ) {
    return "UPI"
  }

  if (
    /\bcard\b/.test(value) ||
    /debit card/.test(value) ||
    /credit card/.test(value)
  ) {
    return "Card"
  }

  return ""
}

/* -----------------------------
   TOTAL DETECTION
----------------------------- */

function detectTotal(text: string): number {
  const lines = text.split("\n")

  const totalKeywords = [
    "grand total",
    "net total",
    "amount payable",
    "amount paid",
    "total",
    "net amount",
  ]

  for (const line of lines) {
    const lower = line.toLowerCase()

    if (totalKeywords.some(k => lower.includes(k))) {
      const amount = detectAmount(line)

      if (amount > 0) return amount
    }
  }

  return 0
}

/* -----------------------------
   LINE ITEM DETECTION
----------------------------- */

function looksLikeProductLine(line: string): boolean {
  const value = line.trim()

  if (!value) return false

  // Ignore obvious summary lines
  if (
    /subtotal|grand total|total|tax|gst|cgst|sgst|discount|saving|round off|change|cash|upi|card|balance|invoice|receipt/i.test(
      value
    )
  ) {
    return false
  }

  // Must contain at least one number
  if (!/\d/.test(value)) return false

  // Need some letters
  if (!/[a-zA-Z]/.test(value)) return false

  return true
}

/* -----------------------------
   MAIN LOCAL PARSER
----------------------------- */

export function parseBillText(
  text: string,
  knownProducts: string[] = []
): ParsedBill {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

  const fullText = lines.join("\n")

  const items: BillItem[] = []

  for (const line of lines) {
    if (!looksLikeProductLine(line)) continue

    const unit = detectUnit(line)
    const qty = detectQuantity(line)
    const amount = detectAmount(line)

    if (!amount) continue

    let name = cleanProductName(line)

    /*
     * Try to match user's existing products.
     */
    const known = knownProducts.find(product => {
      const p = product.toLowerCase()
      const l = line.toLowerCase()

      return l.includes(p)
    })

    if (known) {
      name = known
    }

    if (!name || name.length < 2) continue

    items.push({
      name,
      qty,
      unit,
      amount,
      cat: detectCategory(name),
    })
  }

  return {
    store: detectStore(lines),
    date: detectDate(fullText),
    total: detectTotal(fullText),
    pay: detectPayment(fullText),
    items,
  }
}

/* -----------------------------
   OCR FUNCTION
----------------------------- */

export async function scanBillLocally(
  file: File,
  knownProducts: string[] = [],
  onProgress?: (progress: number) => void
): Promise<ParsedBill> {

  const worker = await createWorker("eng", 1, {
    logger: message => {
      if (message.status === "recognizing text") {
        onProgress?.(Math.round(message.progress * 100))
      }
    },
  })

  try {
    const result = await worker.recognize(file)

    const text = result.data.text

    return parseBillText(text, knownProducts)
  } finally {
    await worker.terminate()
  }
}
