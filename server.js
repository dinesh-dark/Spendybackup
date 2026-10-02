const express = require("express");
const cors = require("cors");
const multer = require("multer");
const vision = require("@google-cloud/vision");

const app = express();

const PORT = process.env.PORT || 3000;

// ----------------------------------------------------
// Middleware
// ----------------------------------------------------

app.use(cors({
    origin: "*",
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024
    }
});

// ----------------------------------------------------
// Google Cloud Vision
// ----------------------------------------------------

const client = new vision.ImageAnnotatorClient();

// ----------------------------------------------------
// Health check
// ----------------------------------------------------

app.get("/", (req, res) => {
    res.json({
        status: "ok",
        service: "Bill OCR API",
        ocr: "Google Cloud Vision"
    });
});

// ----------------------------------------------------
// /api/scan-bill
// ----------------------------------------------------

app.post("/api/scan-bill", upload.single("file"), async (req, res) => {

    try {

        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: "No bill image uploaded"
            });
        }

        console.log(
            "Received:",
            req.file.originalname,
            req.file.mimetype,
            req.file.size
        );

        // ------------------------------------------------
        // Send image to Google Cloud Vision
        // ------------------------------------------------

        const request = {
            image: {
                content: req.file.buffer
            }
        };

        const [result] = await client.documentTextDetection(request);

        if (
            !result ||
            !result.fullTextAnnotation ||
            !result.fullTextAnnotation.text
        ) {

            return res.status(422).json({
                success: false,
                error: "Google Vision could not detect readable text"
            });
        }

        const text = result.fullTextAnnotation.text;

        console.log("OCR TEXT:");
        console.log(text);

        // ------------------------------------------------
        // Parse the bill
        // ------------------------------------------------

        const bill = parseBill(text);

        return res.json({
            success: true,

            store: bill.store,

            date: bill.date,

            items: bill.items,

            subtotal: bill.subtotal,

            tax: bill.tax,

            total: bill.total,

            rawText: text
        });

    } catch (error) {

        console.error("OCR ERROR:", error);

        return res.status(500).json({
            success: false,
            error: "Bill OCR failed",
            message: error.message
        });
    }

});

// ----------------------------------------------------
// BILL PARSER
// ----------------------------------------------------

function parseBill(text) {

    const lines = text
        .split(/\r?\n/)
        .map(x => x.trim())
        .filter(Boolean);

    let store = "";
    let date = "";
    let total = null;
    let subtotal = null;
    let tax = null;

    // ------------------------------------------------
    // STORE
    // ------------------------------------------------

    if (lines.length > 0) {

        const ignored = [
            "invoice",
            "receipt",
            "tax invoice",
            "bill",
            "cash memo"
        ];

        for (let line of lines.slice(0, 8)) {

            const lower = line.toLowerCase();

            if (
                line.length >= 3 &&
                !ignored.some(x => lower.includes(x)) &&
                !/^\d+$/.test(line)
            ) {

                store = line;
                break;
            }
        }
    }

    // ------------------------------------------------
    // DATE
    // ------------------------------------------------

    for (const line of lines) {

        const match = line.match(
            /\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})\b/
        );

        if (match) {

            let d = match[1].padStart(2, "0");
            let m = match[2].padStart(2, "0");
            let y = match[3];

            if (y.length === 2) {
                y = "20" + y;
            }

            date = `${y}-${m}-${d}`;

            break;
        }
    }

    // ------------------------------------------------
    // TOTAL / SUBTOTAL / TAX
    // ------------------------------------------------

    for (const line of lines) {

        const lower = line.toLowerCase();

        const numbers = line.match(
            /(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)\s*$/i
        );

        if (!numbers) continue;

        const amount = parseFloat(
            numbers[1].replace(/,/g, "")
        );

        if (!Number.isFinite(amount)) continue;

        if (
            /\b(grand\s*total|total\s*amount|net\s*amount|amount\s*payable|total)\b/i
                .test(lower)
        ) {

            total = amount;

        } else if (
            /\b(sub\s*total|subtotal)\b/i.test(lower)
        ) {

            subtotal = amount;

        } else if (
            /\b(gst|tax|cgst|sgst|igst)\b/i.test(lower)
        ) {

            tax = amount;
        }
    }

    // ------------------------------------------------
    // ITEMS
    // ------------------------------------------------

    const items = [];

    for (const line of lines) {

        const lower = line.toLowerCase();

        // Ignore obvious non-product rows
        if (
            /\b(total|subtotal|tax|gst|cgst|sgst|igst|discount|change|cash|upi|card|invoice|receipt|round off)\b/i
                .test(lower)
        ) {
            continue;
        }

        // Find final monetary value
        const moneyMatch = line.match(
            /(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)\s*$/i
        );

        if (!moneyMatch) continue;

        const amount = parseFloat(
            moneyMatch[1].replace(/,/g, "")
        );

        if (!Number.isFinite(amount)) continue;

        let name = line
            .substring(0, moneyMatch.index)
            .trim();

        if (!name) continue;

        // Remove leading serial number
        name = name.replace(
            /^\s*\d+[\.\)\-:]\s*/,
            ""
        );

        // Quantity
        let qty = 1;
        let unit = "pcs";

        const quantityMatch = name.match(
            /(?:^|\s)(\d+(?:\.\d+)?)\s*(kg|g|l|ml|pcs|pc|nos)\b/i
        );

        if (quantityMatch) {

            qty = parseFloat(quantityMatch[1]);

            unit = quantityMatch[2].toLowerCase();

            if (unit === "pc" || unit === "nos") {
                unit = "pcs";
            }

            name = name.replace(
                quantityMatch[0],
                " "
            ).trim();
        }

        // Don't add extremely short OCR fragments
        if (name.length < 2) continue;

        items.push({
            name,
            qty,
            unit,
            amount
        });
    }

    // ------------------------------------------------
    // Remove duplicates
    // ------------------------------------------------

    const unique = [];

    const seen = new Set();

    for (const item of items) {

        const key =
            item.name.toLowerCase()
                .replace(/[^a-z0-9]/g, "");

        if (!key) continue;

        if (seen.has(key)) continue;

        seen.add(key);

        unique.push(item);
    }

    return {
        store,
        date,
        items: unique,
        subtotal,
        tax,
        total
    };
}

// ----------------------------------------------------
// Start server
// ----------------------------------------------------

app.listen(PORT, () => {

    console.log(
        `Bill OCR API running on port ${PORT}`
    );

});
