// paddleocr.js
//
// Spend Tracker - Browser OCR
// Tamil + English grocery bill OCR
//
// OCR engine:
// @paddleocr/paddleocr-js
//
// No Google Vision API
// No Claude API
// No Gemini API
//
// OCR runs locally in the browser.

import { PaddleOCR } from "@paddleocr/paddleocr-js";

let ocrEngine = null;
let initializing = null;

export async function initPaddleOCR(onStatus = () => {}) {
  if (ocrEngine) return ocrEngine;
  if (initializing) return initializing;

  initializing = (async () => {
    try {
      onStatus("Loading Tamil OCR engine...");

      ocrEngine = await PaddleOCR.create({
        lang: "ta",
        ocrVersion: "PP-OCRv3",

        textDetectionBatchSize: 1,
        textRecognitionBatchSize: 6,

        ortOptions: {
          backend: "wasm",
          numThreads: 2,
          simd: true
        }
      });

      onStatus("Tamil OCR engine ready.");
      return ocrEngine;

    } catch (error) {
      ocrEngine = null;

      console.error("PaddleOCR initialization error:", error);

      throw new Error(
        "Could not load Tamil PaddleOCR: " +
        (error?.message || String(error))
      );
    } finally {
      initializing = null;
    }
  })();

  return initializing;
}


function resultToText(result) {
  if (!result || !Array.isArray(result.items)) {
    return "";
  }

  return result.items
    .map(item => {
      if (typeof item === "string") {
        return item.trim();
      }

      return String(item?.text || "").trim();
    })
    .filter(Boolean)
    .join("\n");
}


export async function paddleOCR(input, onStatus = () => {}) {
  if (!input) {
    throw new Error("No bill image supplied.");
  }

  const engine = await initPaddleOCR(onStatus);

  onStatus("Reading Tamil/English bill...");

  try {
    const results = await engine.predict(input, {
      textDetLimitSideLen: 1280,
      textRecScoreThresh: 0.25
    });

    if (!results || !results.length) {
      throw new Error("PaddleOCR returned no result.");
    }

    const result = results[0];

    const text = resultToText(result);

    if (!text || !text.trim()) {
      throw new Error(
        "No readable Tamil or English text was detected."
      );
    }

    const count = Array.isArray(result.items)
      ? result.items.length
      : 0;

    onStatus(
      `OCR complete — ${count} text lines detected.`
    );

    console.log("PaddleOCR result:", result);
    console.log("PaddleOCR text:", text);

    return text;

  } catch (error) {
    console.error("PaddleOCR prediction error:", error);

    throw new Error(
      "PaddleOCR failed: " +
      (error?.message || String(error))
    );
  }
}


export async function paddleOCRDetailed(
  input,
  onStatus = () => {}
) {
  const engine = await initPaddleOCR(onStatus);

  return await engine.predict(input);
}


export function disposePaddleOCR() {
  if (!ocrEngine) return;

  try {
    ocrEngine.dispose();
  } catch (error) {
    console.warn(
      "PaddleOCR dispose warning:",
      error
    );
  }

  ocrEngine = null;
}
