// bill-parser.mjs
//
// Spending Tracker bill parser
// OCR engine: PaddleOCR.js
//
// No Google Vision API
// No Claude API
// No Gemini API required
//
// Flow:
//
// Bill image/PDF
//      ↓
// image preparation
//      ↓
// PaddleOCR.js
//      ↓
// raw OCR text
//      ↓
// local bill parser
//      ↓
// structured JSON
//
// The returned structure is compatible with your existing
// index.html bill verification screen.

import {
  paddleOCR
} from "./paddleocr.js";


// ------------------------------------------------------------
// CONSTANTS
// ------------------------------------------------------------

const UNITS = [
  "kg",
  "g",
  "mg",
  "l",
  "ml",
  "pcs",
  "pc",
  "pack",
  "pkt",
  "box",
  "bottle",
  "can",
  "dozen"
];


// ------------------------------------------------------------
// IMAGE PREPARATION
// ------------------------------------------------------------

export async function shrinkImage(file, maxWidth = 1800) {
  if (!file) {
    throw new Error("No image file supplied.");
  }

  // If already a canvas
  if (typeof HTMLCanvasElement !== "undefined" &&
      file instanceof HTMLCanvasElement) {
    return file;
  }

  const bitmap = await createImageBitmap(file);

  const scale = Math.min(
    1,
    maxWidth / bitmap.width
  );

  const width = Math.max(
    1,
    Math.round(bitmap.width * scale)
  );

  const height = Math.max(
    1,
    Math.round(bitmap.height * scale)
  );

  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", {
    willReadFrequently: true
  });

  ctx.drawImage(
    bitmap,
    0,
    0,
    width,
    height
  );

  bitmap.close();

  return canvas;
}


// ------------------------------------------------------------
// PDF → CANVAS
// ------------------------------------------------------------

export async function pdfToCanvas(file) {
  if (!file) {
    throw new Error("No PDF supplied.");
  }

  /*
   * PDF.js is loaded only when a PDF is actually scanned.
   *
   * This keeps normal image scanning lighter.
   */

  if (!window.pdfjsLib) {
    await loadScript(
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs",
      true
    );
  }

  const pdfjsLib = window.pdfjsLib;

  if (!pdfjsLib) {
    throw new Error(
      "PDF engine could not be loaded."
    );
  }

  const buffer = await file.arrayBuffer();

  const pdf = await pdfjsLib.getDocument({
    data: buffer
  }).promise;

  if (!pdf.numPages) {
    throw new Error("PDF contains no pages.");
  }

  /*
   * Use the first page.
   *
   * Grocery bills are normally single-page documents.
   */
  const page = await pdf.getPage(1);

  const viewport = page.getViewport({
    scale: 2
  });

  const canvas = document.createElement("canvas");

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  const ctx = canvas.getContext("2d");

  await page.render({
    canvasContext: ctx,
    viewport
  }).promise;

  return canvas;
}


// ------------------------------------------------------------
// SCRIPT LOADER
// ------------------------------------------------------------

function loadScript(src, module = false) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(
      `script[src="${src}"]`
    );

    if (existing) {
      existing.addEventListener(
        "load",
        resolve,
        { once: true }
      );

      existing.addEventListener(
        "error",
        reject,
        { once: true }
      );

      return;
    }

    const script = document.createElement("script");

    script.src = src;

    if (module) {
      script.type = "module";
    }

    script.onload = resolve;

    script.onerror = () => {
      reject(
        new Error(
          "Could not load external script: " + src
        )
      );
    };

    document.head.appendChild(script);
  });
}


// ------------------------------------------------------------
// PADDLE OCR
// ------------------------------------------------------------

export async function localOcr(
  canvas,
  onStatus = () => {}
) {
  if (!canvas) {
    throw new Error("No bill image available.");
  }

  onStatus(
    "Starting free browser OCR..."
  );

  try {
    const text = await paddleOCR(
      canvas,
      onStatus
    );

    if (!text || !text.trim()) {
      throw new Error(
        "No readable text was detected."
      );
    }

    return text;
  } catch (error) {
    console.error(
      "PaddleOCR error:",
      error
    );

    throw new Error(
      error?.message ||
      "Could not read the bill."
    );
  }
}


// ------------------------------------------------------------
// GEMINI COMPATIBILITY FUNCTION
// ------------------------------------------------------------
//
// Your current index.html still contains the Gemini fallback
// logic:
//
// if (S.geminiKey) {
//    try {
//       parseWithGemini(...)
//    }
// }
//
// We don't want the app to use Gemini anymore.
//
// Therefore this function intentionally throws, allowing your
// existing index.html to fall back to localOcr().
//
// This means an old Gemini key stored in localStorage will NOT
// cause a Gemini API call.
//

export async function parseWithGemini() {
  throw new Error(
    "Cloud AI disabled. Using local PaddleOCR instead."
  );
}


// ------------------------------------------------------------
// TEXT NORMALIZATION
// ------------------------------------------------------------

function cleanText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


function cleanLine(line) {
  return String(line || "")
    .replace(/\s+/g, " ")
    .trim();
}


// ------------------------------------------------------------
// NUMBER HELPERS
// ------------------------------------------------------------

function numberFromText(text) {
  if (!text) return 0;

  let s = String(text)
    .replace(/,/g, "")
    .replace(/[₹$€£]/g, "")
    .trim();

  const matches = s.match(
    /\d+(?:\.\d+)?/g
  );

  if (!matches || !matches.length) {
    return 0;
  }

  return Number(
    matches[matches.length - 1]
  ) || 0;
}


function moneyValues(line) {
  const cleaned = String(line)
    .replace(/[₹$€£]/g, "")
    .replace(/,/g, "");

  const matches = cleaned.match(
    /\d+(?:\.\d{1,2})?/g
  );

  if (!matches) {
    return [];
  }

  return matches
    .map(Number)
    .filter(n => Number.isFinite(n));
}


// ------------------------------------------------------------
// DATE DETECTION
// ------------------------------------------------------------

function detectDate(text, fallback) {
  const patterns = [

    // DD/MM/YYYY
    /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/,

    // YYYY/MM/DD
    /\b(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})\b/,

    // DD-MM-YY
    /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2})\b/
  ];

  for (const regex of patterns) {
    const m = String(text).match(regex);

    if (!m) continue;

    let day;
    let month;
    let year;

    if (
      m[1].length === 4
    ) {
      year = Number(m[1]);
      month = Number(m[2]);
      day = Number(m[3]);
    } else {
      day = Number(m[1]);
      month = Number(m[2]);
      year = Number(m[3]);

      if (year < 100) {
        year += 2000;
      }
    }

    if (
      year >= 2000 &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      return [
        year,
        String(month).padStart(2, "0"),
        String(day).padStart(2, "0")
      ].join("-");
    }
  }

  return fallback;
}


// ------------------------------------------------------------
// PAYMENT METHOD
// ------------------------------------------------------------

function detectPayment(text) {
  const t = String(text)
    .toLowerCase();

  if (
    /\bupi\b/.test(t) ||
    /phonepe/.test(t) ||
    /gpay/.test(t) ||
    /google pay/.test(t) ||
    /paytm/.test(t)
  ) {
    return "UPI";
  }

  if (
    /credit card/.test(t) ||
    /\bcredit\b/.test(t)
  ) {
    return "Credit Card";
  }

  if (
    /debit card/.test(t) ||
    /\bdebit\b/.test(t)
  ) {
    return "Debit Card";
  }

  if (
    /cash/.test(t)
  ) {
    return "Cash";
  }

  return "Cash";
}


// ------------------------------------------------------------
// STORE DETECTION
// ------------------------------------------------------------

function detectStore(lines) {
  const ignore = [
    "invoice",
    "bill",
    "receipt",
    "tax invoice",
    "gst",
    "date",
    "time",
    "phone",
    "mobile",
    "cashier",
    "customer",
    "total",
    "subtotal",
    "amount",
    "qty",
    "quantity",
    "price",
    "rate"
  ];

  /*
   * Usually the store name appears near the top.
   */

  for (
    let i = 0;
    i < Math.min(lines.length, 8);
    i++
  ) {
    const line = cleanLine(lines[i]);

    if (!line) continue;

    const lower = line.toLowerCase();

    if (
      ignore.some(word =>
        lower === word ||
        lower.startsWith(word + " ")
      )
    ) {
      continue;
    }

    if (
      line.length >= 3 &&
      line.length <= 80 &&
      !/^\d+$/.test(line)
    ) {
      return line;
    }
  }

  return "";
}


// ------------------------------------------------------------
// TOTAL DETECTION
// ------------------------------------------------------------

function detectTotal(lines) {
  const totalPatterns = [
    /\bgrand\s*total\b/i,
    /\bnet\s*amount\b/i,
    /\bnet\s*payable\b/i,
    /\bamount\s*payable\b/i,
    /\btotal\s*amount\b/i,
    /\btotal\b/i,
    /மொத்தம்/i
  ];

  /*
   * Search from bottom to top because totals are normally
   * towards the bottom of receipts.
   */

  for (
    let i = lines.length - 1;
    i >= 0;
    i--
  ) {
    const line = lines[i];

    if (
      totalPatterns.some(
        p => p.test(line)
      )
    ) {
      const values = moneyValues(line);

      if (values.length) {
        return values[values.length - 1];
      }

      /*
       * Sometimes the word TOTAL is on one line and
       * the amount is on the next line.
       */
      if (i + 1 < lines.length) {
        const nextValues =
          moneyValues(lines[i + 1]);

        if (nextValues.length) {
          return nextValues[
            nextValues.length - 1
          ];
        }
      }
    }
  }

  return 0;
}


// ------------------------------------------------------------
// PRODUCT LINE DETECTION
// ------------------------------------------------------------

function looksLikeProductLine(line) {
  if (!line) return false;

  const lower = line.toLowerCase();

  /*
   * Header/footer words that shouldn't become products.
   */

  const ignoredWords = [
    "invoice",
    "bill no",
    "bill no.",
    "invoice no",
    "date",
    "time",
    "cashier",
    "customer",
    "subtotal",
    "total",
    "grand total",
    "amount payable",
    "net amount",
    "gst",
    "cgst",
    "sgst",
    "igst",
    "tax",
    "discount",
    "round off",
    "thank you",
    "balance",
    "change",
    "payment",
    "upi",
    "cash",
    "card",
    "qty",
    "quantity",
    "price",
    "rate",
    "description",
    "particulars"
  ];

  if (
    ignoredWords.some(
      word =>
        lower === word ||
        lower.startsWith(word + " ")
    )
  ) {
    return false;
  }

  /*
   * Ignore lines containing only numbers.
   */

  if (
    /^[\d\s.,₹$€£/-]+$/.test(line)
  ) {
    return false;
  }

  /*
   * Need at least one letter.
   */

  if (!/[A-Za-z\u0B80-\u0BFF]/.test(line)) {
    return false;
  }

  return true;
}


// ------------------------------------------------------------
// PRODUCT LINE PARSER
// ------------------------------------------------------------

function parseProductLine(line) {
  const original = cleanLine(line);

  if (!looksLikeProductLine(original)) {
    return null;
  }

  let working = original;

  /*
   * Extract all numeric values.
   */
  const values = moneyValues(working);

  if (!values.length) {
    return null;
  }

  /*
   * Usually grocery receipt formats look like:
   *
   * Rice 5 kg 450
   * Milk 2 60
   * Sugar 1 kg 55
   *
   * Last number is generally line amount.
   */

  const amount =
    values[values.length - 1];

  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return null;
  }

  /*
   * Remove currency/number values from the product name.
   */
  let name = working
    .replace(/[₹$€£]/g, "")
    .replace(
      /\d+(?:\.\d+)?/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();

  /*
   * Remove common unit words from the end/name
   * only when useful.
   */
  let qty = 1;
  let unit = "pcs";

  const unitRegex =
    /\b(kg|kgs|g|gm|gms|mg|l|ltr|litre|litres|ml|pcs|pc|pack|pkt|box|bottle|can|dozen)\b/i;

  const unitMatch =
    original.match(unitRegex);

  if (unitMatch) {
    const u =
      unitMatch[1].toLowerCase();

    if (
      u === "kg" ||
      u === "kgs"
    ) {
      unit = "kg";
    } else if (
      u === "g" ||
      u === "gm" ||
      u === "gms"
    ) {
      unit = "g";
    } else if (u === "mg") {
      unit = "mg";
    } else if (
      u === "l" ||
      u === "ltr" ||
      u === "litre" ||
      u === "litres"
    ) {
      unit = "l";
    } else if (u === "ml") {
      unit = "ml";
    } else if (
      u === "pc" ||
      u === "pcs"
    ) {
      unit = "pcs";
    } else {
      unit = u;
    }
  }

  /*
   * Look for quantity immediately before unit.
   */
  if (unitRegex.test(original)) {
    const qMatch =
      original.match(
        /(\d+(?:\.\d+)?)\s*(kg|kgs|g|gm|gms|mg|l|ltr|litre|litres|ml|pcs|pc|pack|pkt|box|bottle|can|dozen)\b/i
      );

    if (qMatch) {
      qty = Number(qMatch[1]) || 1;
    }
  } else {
    /*
     * If there are multiple numbers and no unit,
     * the first number may be quantity.
     */
    if (values.length >= 2) {
      const possibleQty =
        values[values.length - 2];

      if (
        possibleQty > 0 &&
        possibleQty <= 100
      ) {
        qty = possibleQty;
      }
    }
  }

  name = name
    .replace(
      /\b(kg|kgs|g|gm|gms|mg|l|ltr|litre|litres|ml|pcs|pc|pack|pkt|box|bottle|can|dozen)\b/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();

  /*
   * Reject names that became too short.
   */
  if (
    !name ||
    name.length < 2
  ) {
    return null;
  }

  /*
   * Reject obvious totals/metadata.
   */
  const lowerName =
    name.toLowerCase();

  if (
    /^(total|subtotal|gst|tax|discount|amount|cash|upi|change)$/.test(
      lowerName
    )
  ) {
    return null;
  }

  return {
    name,
    cat: "Other",
    qty,
    unit,
    amount: Number(
      amount.toFixed(2)
    )
  };
}


// ------------------------------------------------------------
// DUPLICATE CLEANING
// ------------------------------------------------------------

function cleanItems(items) {
  const result = [];

  for (const item of items) {
    if (!item) continue;

    const name = cleanLine(
      item.name
    );

    if (!name) continue;

    /*
     * Avoid very obvious OCR garbage.
     */
    if (
      name.length > 100
    ) {
      continue;
    }

    const duplicate =
      result.find(
        x =>
          x.name.toLowerCase() ===
          name.toLowerCase()
      );

    if (duplicate) {
      duplicate.amount += item.amount;
    } else {
      result.push({
        ...item,
        name,
        amount: Number(
          item.amount || 0
        )
      });
    }
  }

  return result;
}


// ------------------------------------------------------------
// LOCAL BILL PARSER
// ------------------------------------------------------------

export function parseLocalText(
  rawText,
  fallbackDate
) {
  const text =
    cleanText(rawText);

  if (!text) {
    return {
      store: "",
      date: fallbackDate,
      pay: "Cash",
      total: 0,
      items: []
    };
  }

  const lines = text
    .split("\n")
    .map(cleanLine)
    .filter(Boolean);

  const store =
    detectStore(lines);

  const date =
    detectDate(
      text,
      fallbackDate
    );

  const pay =
    detectPayment(text);

  const detectedTotal =
    detectTotal(lines);

  const parsedItems = [];

  for (const line of lines) {
    const item =
      parseProductLine(line);

    if (item) {
      parsedItems.push(item);
    }
  }

  const items =
    cleanItems(parsedItems);

  /*
   * If the bill total wasn't directly detected,
   * calculate it from the scanned lines.
   */
  let total = detectedTotal;

  if (
    !total &&
    items.length
  ) {
    total = items.reduce(
      (sum, item) =>
        sum + Number(item.amount || 0),
      0
    );
  }

  return {
    store,
    date,
    pay,
    total: Number(
      (total || 0).toFixed(2)
    ),
    items
  };
}


// ------------------------------------------------------------
// DEFAULT EXPORT
// ------------------------------------------------------------

export default {
  shrinkImage,
  pdfToCanvas,
  parseWithGemini,
  localOcr,
  parseLocalText
};
