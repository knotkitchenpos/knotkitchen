const Anthropic = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
const createHttpError = require("http-errors");

/**
 * KnotKitchen Books "Scan bill": reads a bill photo or PDF and returns the
 * expense fields to pre-fill. The partners check them before saving; nothing
 * is saved from here. Off unless ANTHROPIC_API_KEY is set. What leaves the
 * server is the bill itself, nothing else from the books.
 */
const MODEL = process.env.BOOKS_AI_MODEL || "claude-opus-5-5";

// Must match books/src/lib/firm.js CATEGORIES.
const CATEGORIES = [
  "Software & subscriptions", "Hosting & domain", "Hardware & equipment", "Devices for resale (stock)", "Marketing & ads",
  "Travel & conveyance", "Phone & internet", "Professional fees (CA/legal)", "Registration & govt fees", "Office & stationery",
  "Rent", "Salaries & contractors", "Bank charges", "Food & entertainment", "Other",
];
const RATES = [0, 5, 12, 18, 28, 40];

const SCHEMA = {
  type: "object",
  properties: {
    isBill: { type: "boolean", description: "true if this is a bill, invoice or receipt" },
    vendor: { type: "string", description: "seller / supplier name as printed" },
    vendorGstin: { type: "string", description: "seller's 15-character GSTIN, or empty" },
    billedTo: { type: "string", description: "buyer name the bill is addressed to, or empty" },
    invoiceNo: { type: "string" },
    date: { type: "string", description: "invoice date as YYYY-MM-DD, or empty" },
    description: { type: "string", description: "short summary of what was bought, under 80 characters" },
    amountBeforeGst: { type: "number", description: "taxable value in rupees, before GST" },
    gstRate: { type: "number", description: "GST rate in percent: 0, 5, 12, 18, 28 or 40" },
    taxType: { type: "string", enum: ["cgst_sgst", "igst", "none"] },
    totalAmount: { type: "number", description: "grand total in rupees as printed" },
    category: { type: "string", enum: CATEGORIES },
    note: { type: "string", description: "anything unclear the user should check, or empty" },
  },
  required: ["isBill", "vendor", "vendorGstin", "billedTo", "invoiceNo", "date", "description", "amountBeforeGst", "gstRate", "taxType", "totalAmount", "category", "note"],
  additionalProperties: false,
};

const SYSTEM = `You read Indian purchase bills for a small partnership firm's expense book and return the fields as JSON.
- Amounts in rupees as plain numbers. amountBeforeGst is the taxable value; if the bill only shows a GST-inclusive total, work the taxable value back from the rate.
- taxType: "cgst_sgst" if the bill charges CGST and SGST/UTGST, "igst" if it charges IGST, "none" if it charges no GST. With mixed rates, use the rate on the largest amount and say so in note.
- vendorGstin only if printed for the seller (not the buyer). Never invent a GSTIN, date or amount: leave text empty or 0 and explain in note.
- category: pick the closest. Devices bought to resell to restaurants are "Devices for resale (stock)"; restaurant meals and snacks are "Food & entertainment".
- If the image is not a bill, set isBill false and explain in note.`;

let client;
const getClient = () => (client ||= new Anthropic({ timeout: 60000, maxRetries: 1 }));

const isEnabled = () => !!String(process.env.ANTHROPIC_API_KEY || "").trim();

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const scanBill = async (buf, mime) => {
  if (!isEnabled()) throw createHttpError(503, "Bill scanning is not switched on for this server.");
  let source;
  if (mime === "application/pdf") source = { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } };
  else if (IMAGE_TYPES.has(mime)) source = { type: "image", source: { type: "base64", media_type: mime, data: buf.toString("base64") } };
  else throw createHttpError(415, "Scan works on JPG, PNG or WebP photos and PDFs.");

  let response;
  try {
    response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: [source, { type: "text", text: "Read this bill." }] }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw createHttpError(502, "The AI key on this server is not valid.");
    if (err instanceof Anthropic.RateLimitError) throw createHttpError(429, "Bill scanning is busy. Try again in a moment.");
    if (err instanceof Anthropic.APIConnectionError) throw createHttpError(502, "Could not reach the AI service. Try again.");
    if (err instanceof Anthropic.APIError) throw createHttpError(502, "The AI service could not read this bill. Fill it in by hand.");
    throw err;
  }
  if (response.stop_reason === "refusal") throw createHttpError(422, "This file could not be read as a bill. Fill it in by hand.");
  const text = response.content.find((b) => b.type === "text")?.text || "";
  let out;
  try {
    out = JSON.parse(text);
  } catch {
    throw createHttpError(502, "The bill could not be read. Fill it in by hand.");
  }
  return clean(out);
};

// Never trust the shape blindly: the form only gets values it can use.
const clean = (o) => {
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v) * 100) / 100 : 0);
  const str = (v, n = 120) => String(v ?? "").trim().slice(0, n);
  const gstin = str(o.vendorGstin, 15).toUpperCase();
  return {
    isBill: o.isBill !== false,
    vendor: str(o.vendor),
    vendorGstin: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin) ? gstin : "",
    billedTo: str(o.billedTo),
    invoiceNo: str(o.invoiceNo, 40),
    date: /^\d{4}-\d{2}-\d{2}$/.test(str(o.date)) ? str(o.date) : "",
    description: str(o.description, 100),
    amountBeforeGst: num(o.amountBeforeGst),
    gstRate: RATES.includes(Number(o.gstRate)) ? Number(o.gstRate) : 0,
    taxType: ["cgst_sgst", "igst", "none"].includes(o.taxType) ? o.taxType : "none",
    totalAmount: num(o.totalAmount),
    category: CATEGORIES.includes(o.category) ? o.category : "Other",
    note: str(o.note, 300),
  };
};

module.exports = { scanBill, clean, isEnabled, CATEGORIES };
