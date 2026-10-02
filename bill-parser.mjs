// bill-parser.mjs - Dedicated OCR & Knowledge Interpreter

export const GROCERY_KNOWLEDGE = [
  { trigger: /cinthol|soap|hamam|lux|lifebuoy|dove|mysore/i, name: "Bath Soap", cat: "Personal care", unit: "pcs" },
  { trigger: /oil|gold\s*winner|sunflower|groundnut|gingelly|deepam/i, name: "Cooking Oil", cat: "Grocery", unit: "L" },
  { trigger: /rice|ponni|basmati|idly\s*rice/i, name: "Rice", cat: "Grains", unit: "kg" },
  { trigger: /toor|urad|moong|channa|dal|dhal|paruppu/i, name: "Dal / Pulses", cat: "Grains", unit: "kg" },
  { trigger: /atta|maida|sooji|flour|rava/i, name: "Wheat Flour / Atta", cat: "Grains", unit: "kg" },
  { trigger: /sugar|sakkarai|jaggery/i, name: "Sugar", cat: "Grocery", unit: "kg" },
  { trigger: /salt|uppu/i, name: "Salt", cat: "Grocery", unit: "kg" },
  { trigger: /mustard|kadugu|jeera|seeragam|pepper|milagu|sompu/i, name: "Spices", cat: "Grocery", unit: "g" },
  { trigger: /tea|coffee|bru|taj\s*mahal/i, name: "Tea / Coffee", cat: "Grocery", unit: "g" },
  { trigger: /paste|colgate|close\s*up|brush/i, name: "Oral Care", cat: "Personal care", unit: "pcs" },
  { trigger: /detergent|surf|ariel|rin|vim|dishwash/i, name: "Cleaning Supplies", cat: "Household", unit: "pcs" }
];

export const REJECT_PATTERNS = [
  /no[\s.:-]*\d+/i,
  /road|street|nagar|salai|lane|pallavaram|chennai|tamil\s*nadu|pincode|pin[\s.:-]*\d{6}/i,
  /bill\s*no|inv\s*no|invoice|estimate|cash\s*bill|memo|counter/i,
  /phone|mobile|cell|ph[\s.:-]*\d+/i,
  /gstin|tin|fssai|cin/i,
  /paid\s*[:=]|returned|change|balance|round\s*off|sub\s*total/i,
  /thank\s*you|visit\s*again|save\s*trees|customer/i
];

export function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const maxDim = 1800;
      const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image processing failed"));
    };
    img.src = url;
  });
}

let pdfjsReady = null;
export function loadPdfJs() {
  if (pdfjsReady) return pdfjsReady;
  pdfjsReady = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.js";
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js";
      resolve();
    };
    s.onerror = () => reject(new Error("PDF engine failed to load"));
    document.head.appendChild(s);
  });
  return pdfjsReady;
}

export async function pdfToCanvas(file) {
  await loadPdfJs();
  const buf = await file.arrayBuffer();
  const doc = await window.pdfjsLib.getDocument({ data: buf }).promise;
  const page = await doc.getPage(1);
  const vp0 = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 1600 / vp0.width);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = vp.width;
  canvas.height = vp.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
  return canvas;
}

let tessReady = null;
export function loadTess() {
  if (tessReady) return tessReady;
  tessReady = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("OCR engine failed to load"));
    document.head.appendChild(s);
  });
  return tessReady;
}

export async function localOcr(canvas, statusCb) {
  await loadTess();
  const result = await window.Tesseract.recognize(canvas, "eng", {
    logger: m => {
      if (statusCb && m.status) statusCb(`${m.status} ${m.progress ? Math.round(m.progress * 100) + "%" : ""}`);
    }
  });
  return (result && result.data && result.data.text) || "";
}

export async function parseWithGemini(base64Data, apiKey, categoriesStr, defaultDate, statusCb) {
  if (statusCb) statusCb("Interpreting bill with Gemini Vision AI...");
  const prompt = `You are an expert grocery bill parser specifically trained on Indian & Tamil Nadu provision shop receipts (e.g. thermal rolls, printed slips from provision stores).
Extract receipt data into clean JSON adhering strictly to this schema:
{
  "store": "Name of store/shop",
  "date": "YYYY-MM-DD",
  "pay": "Cash, UPI, or Card",
  "total": 0.00,
  "items": [
    {
      "name": "Standard clean product name",
      "qty": 1.0,
      "unit": "kg, g, L, ml, or pcs",
      "amount": 0.00,
      "cat": "Pick closest category from: ${categoriesStr}"
    }
  ]
}
RULES:
1. Ignore header address blocks, phone numbers, bill numbers, and footer tender summaries (e.g. 'Paid', 'Returned').
2. Parse tabular rows [Item] [Qty] [Rate] [Total] properly.
3. Clean typos in product names. Return ONLY raw JSON without markdown or backticks.`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: "image/jpeg", data: base64Data } }
        ]
      }],
      generationConfig: { response_mime_type: "application/json" }
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || "Gemini Vision rejected request");
  }
  const data = await res.json();
  return JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text);
}

export function parseLocalText(rawText, defaultDate) {
  const lines = rawText.split("\n").map(l => l.trim()).filter(Boolean);

  let store = "";
  for (const line of lines.slice(0, 5)) {
    if (!REJECT_PATTERNS.some(re => re.test(line)) && line.length >= 3 && !/^\d/.test(line)) {
      store = line;
      break;
    }
  }

  let date = defaultDate;
  const dMatch = rawText.match(/([0-3]?\d)[\/\-.]([01]?\d)[\/\-.]((?:20)?\d\d)/);
  if (dMatch) {
    let dd = +dMatch[1], mm = +dMatch[2], yy = +dMatch[3];
    if (yy < 100) yy += 2000;
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      date = `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }

  let billTotal = 0;
  const tMatch = rawText.match(/(?:total|net\s*amt|amount\s*payable|grand\s*total)[^\d\n]*([0-9,]+\.?[0-9]{0,2})/i);
  if (tMatch) billTotal = parseFloat(tMatch[1].replace(/,/g, "")) || 0;

  const items = [];
  for (let line of lines) {
    if (REJECT_PATTERNS.some(re => re.test(line))) continue;

    const nums = [];
    const numRegex = /(?:\b|^)(\d+(?:\.\d+)?)(?:\b|$)/g;
    let nm;
    while ((nm = numRegex.exec(line)) !== null) {
      nums.push(parseFloat(nm[1]));
    }
    if (nums.length < 1) continue;

    let netAmount = nums[nums.length - 1];
    if (isNaN(netAmount) || netAmount <= 0 || netAmount > 50000) continue;

    let qty = 1, unit = "pcs";
    const unitMatch = line.match(/(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|l|ltr|ltrs|ml|pcs|nos)/i);
    if (unitMatch) {
      qty = parseFloat(unitMatch[1]) || 1;
      const uStr = unitMatch[2].toLowerCase();
      if (uStr.startsWith("kg")) unit = "kg";
      else if (uStr.startsWith("g")) unit = "g";
      else if (uStr.startsWith("l")) unit = "L";
      else if (uStr.startsWith("ml")) unit = "ml";
    } else if (nums.length >= 3) {
      const possibleQty = nums[nums.length - 3];
      const possibleRate = nums[nums.length - 2];
      if (Math.abs(possibleQty * possibleRate - netAmount) <= 1.0) {
        qty = possibleQty;
      }
    }

    let cleanName = line
      .replace(/(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|l|ltr|ltrs|ml|pcs|nos)/gi, "")
      .replace(/[\d.,]+$/g, "")
      .replace(/[0-9*#@₹$:%]/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (cleanName.length < 2) continue;

    let detectedCategory = "Grocery";
    for (const entry of GROCERY_KNOWLEDGE) {
      if (entry.trigger.test(cleanName) || entry.trigger.test(line)) {
        cleanName = entry.name;
        detectedCategory = entry.cat;
        if (unit === "pcs" && entry.unit) unit = entry.unit;
        break;
      }
    }

    items.push({
      name: cleanName,
      qty: qty,
      unit: unit,
      amount: netAmount,
      cat: detectedCategory,
      on: true
    });
  }

  return {
    store,
    date,
    pay: /upi|gpay|phonepe/i.test(rawText) ? "UPI" : /card|pos/i.test(rawText) ? "Card" : "Cash",
    total: billTotal,
    items
  };
}
