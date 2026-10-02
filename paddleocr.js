// paddleocr.js
//
// Spend Tracker - Browser OCR
//
// OCR engine:
// @paddleocr/paddleocr-js
//
// No Google Vision API
// No Claude API
// No Gemini API
//
// OCR runs in the user's browser.
//
// Input:
// HTMLCanvasElement
//
// Output:
// Plain OCR text


import { PaddleOCR } from "@paddleocr/paddleocr-js";


let ocrEngine = null;
let initializing = null;


// ------------------------------------------------------------
// INITIALIZE PADDLE OCR
// ------------------------------------------------------------

export async function initPaddleOCR(
  onStatus = () => {}
) {

  // Already initialized
  if (ocrEngine) {
    return ocrEngine;
  }


  // If initialization is already running,
  // wait for that same initialization.
  if (initializing) {
    return initializing;
  }


  initializing = (async () => {

    try {

      onStatus(
        "Loading PaddleOCR engine..."
      );


      /*
       * PP-OCRv5
       *
       * Tamil language model:
       * "ta"
       *
       * This is useful for Tamil/English receipts.
       *
       * WASM keeps inference in the browser.
       */

      ocrEngine = await PaddleOCR.create({

        lang: "ta",

        ocrVersion: "PP-OCRv5",

        textDetectionBatchSize: 1,

        textRecognitionBatchSize: 6,

        ortOptions: {

          backend: "wasm",

          numThreads: 2,

          simd: true

        }

      });


      onStatus(
        "PaddleOCR engine ready."
      );


      return ocrEngine;

    } catch (error) {

      ocrEngine = null;

      console.error(
        "PaddleOCR initialization error:",
        error
      );


      throw new Error(
        "Could not load PaddleOCR: " +
        (
          error?.message ||
          String(error)
        )
      );

    } finally {

      initializing = null;

    }

  })();


  return initializing;
}


// ------------------------------------------------------------
// OCR RESULT → TEXT
// ------------------------------------------------------------

function resultToText(result) {

  if (
    !result ||
    !Array.isArray(result.items)
  ) {
    return "";
  }


  /*
   * PaddleOCR returns:
   *
   * {
   *   text: "...",
   *   score: ...,
   *   poly: [...]
   * }
   *
   * We only need the recognized text.
   */

  return result.items

    .map(item => {

      if (
        typeof item === "string"
      ) {
        return item.trim();
      }


      return String(
        item?.text || ""
      ).trim();

    })

    .filter(Boolean)

    .join("\n");
}


// ------------------------------------------------------------
// RUN OCR
// ------------------------------------------------------------

export async function paddleOCR(
  input,
  onStatus = () => {}
) {

  if (!input) {

    throw new Error(
      "No bill image supplied."
    );

  }


  const engine =
    await initPaddleOCR(
      onStatus
    );


  onStatus(
    "Reading bill with PaddleOCR..."
  );


  try {

    /*
     * PaddleOCR.js accepts HTMLCanvasElement
     * directly.
     */

    const results =
      await engine.predict(
        input,
        {
          /*
           * Receipt text can be relatively small,
           * so allow a reasonably large detection
           * image side.
           */

          textDetLimitSideLen: 1280,

          textRecScoreThresh: 0.25
        }
      );


    if (
      !results ||
      !results.length
    ) {

      throw new Error(
        "PaddleOCR returned no result."
      );

    }


    const result =
      results[0];


    const text =
      resultToText(
        result
      );


    if (
      !text ||
      !text.trim()
    ) {

      throw new Error(
        "No readable text was detected in the bill."
      );

    }


    const count =
      Array.isArray(result.items)
        ? result.items.length
        : 0;


    onStatus(
      `OCR complete — ${count} text lines detected.`
    );


    console.log(
      "PaddleOCR result:",
      result
    );


    console.log(
      "PaddleOCR text:",
      text
    );


    return text;

  } catch (error) {

    console.error(
      "PaddleOCR prediction error:",
      error
    );


    throw new Error(
      "PaddleOCR failed: " +
      (
        error?.message ||
        String(error)
      )
    );

  }

}


// ------------------------------------------------------------
// DETAILED OCR
// ------------------------------------------------------------
//
// Useful for future features such as:
// - confidence display
// - highlighting detected text
// - OCR debugging
// - receipt text boxes
//

export async function paddleOCRDetailed(
  input,
  onStatus = () => {}
) {

  const engine =
    await initPaddleOCR(
      onStatus
    );


  return await engine.predict(
    input
  );

}


// ------------------------------------------------------------
// DISPOSE OCR
// ------------------------------------------------------------

export function disposePaddleOCR() {

  if (!ocrEngine) {
    return;
  }


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
