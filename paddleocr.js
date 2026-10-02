// paddleocr.js
// Browser-side OCR using the official PaddleOCR.js SDK.
// No API key. No Google Cloud. No Claude.
// OCR runs locally in the user's browser.

import { PaddleOCR } from "@paddleocr/paddleocr-js";

let ocrEngine = null;
let initializing = null;

/**
 * Initialize PaddleOCR once and reuse it.
 *
 * PP-OCRv5 Tamil model also supports English, making it suitable
 * for Indian/Tamil receipts containing both scripts.
 */
export async function initPaddleOCR(onStatus = () => {}) {
  if (ocrEngine) {
    return ocrEngine;
  }

  if (initializing) {
    return initializing;
  }

  initializing = (async () => {
    onStatus("Loading PaddleOCR engine...");

    try {
      ocrEngine = await PaddleOCR.create({
        lang: "ta",
        ocrVersion: "PP-OCRv5",

        ortOptions: {
          backend: "wasm",
          numThreads: 2,
          simd: true
        }
      });

      onStatus("PaddleOCR ready.");
      return ocrEngine;
    } catch (error) {
      ocrEngine = null;
      throw new Error(
        "Could not initialize PaddleOCR: " +
        (error?.message || error)
      );
    } finally {
      initializing = null;
    }
  })();

  return initializing;
}

/**
 * Convert OCR result into plain text.
 */
function resultToText(result) {
  if (!result || !Array.isArray(result.items)) {
    return "";
  }

  return result.items
    .map(item => {
      if (typeof item === "string") return item;

      return String(item?.text || "").trim();
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Run PaddleOCR on an image/canvas/blob/file.
 *
 * Accepted inputs include:
 *   - File
 *   - Blob
 *   - HTMLCanvasElement
 *   - ImageBitmap
 *   - HTMLImageElement
 */
export async function paddleOCR(input, onStatus = () => {}) {
  if (!input) {
    throw new Error("No image supplied to OCR.");
  }

  const engine = await initPaddleOCR(onStatus);

  onStatus("Reading bill with PaddleOCR...");

  try {
    const results = await engine.predict(input);

    if (!results || !results.length) {
      throw new Error("PaddleOCR returned no result.");
    }

    const result = results[0];

    const text = resultToText(result);

    if (!text.trim()) {
      throw new Error(
        "No readable text was detected in the bill."
      );
    }

    onStatus(
      `OCR complete — ${result.items?.length || 0} text lines detected.`
    );

    return text;
  } catch (error) {
    throw new Error(
      "PaddleOCR failed: " +
      (error?.message || error)
    );
  }
}

/**
 * Optional helper if you want access to the detailed OCR result
 * including confidence scores and bounding boxes.
 */
export async function paddleOCRDetailed(input, onStatus = () => {}) {
  const engine = await initPaddleOCR(onStatus);

  return await engine.predict(input);
}

/**
 * Release OCR resources when required.
 */
export function disposePaddleOCR() {
  if (ocrEngine) {
    try {
      ocrEngine.dispose();
    } catch (_) {
      // Ignore disposal errors.
    }
  }

  ocrEngine = null;
}
