const createHttpError = require("http-errors");
const { MAX_FILE_BYTES } = require("../services/imageValidator");

/**
 * Single-file upload parser (§25).
 *
 * The project has no multer dependency, and adding one purely to read a single
 * image field is unnecessary weight — so this implements just the subset of
 * multipart/form-data needed here, with a hard byte cap enforced while
 * streaming (the request is destroyed as soon as it exceeds the limit, so an
 * attacker cannot exhaust memory by sending a huge body).
 *
 * Two content types are accepted:
 *   multipart/form-data  — normal browser upload  (field: "file")
 *   application/json     — { fileName, fileBase64 } convenience path
 *
 * Produces: req.uploadedFile = { buffer, fileName, declaredMimeType }
 * The declared mime type is NOT trusted; imageValidator re-sniffs the bytes.
 */

const readBody = (req, limitBytes) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        fail(createHttpError(413, "File is too large. Maximum size is 5MB."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });

    req.on("error", () => fail(createHttpError(400, "Upload failed.")));
  });

const getBoundary = (contentType) => {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!match) return null;
  return (match[1] || match[2] || "").trim();
};

/** Extract the first file part from a multipart body. */
const parseMultipart = (body, boundary) => {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];

  let start = body.indexOf(delimiter);
  if (start === -1) return null;
  start += delimiter.length;

  while (start < body.length) {
    // "--" immediately after the delimiter marks the terminating boundary.
    if (body[start] === 0x2d && body[start + 1] === 0x2d) break;

    // Skip the CRLF that follows the boundary.
    if (body[start] === 0x0d && body[start + 1] === 0x0a) start += 2;

    const next = body.indexOf(delimiter, start);
    if (next === -1) break;

    // The part's content ends with a CRLF before the next boundary.
    const partBuf = body.slice(start, next - 2);
    const headerEnd = partBuf.indexOf("\r\n\r\n");
    if (headerEnd !== -1) {
      const headers = partBuf.slice(0, headerEnd).toString("utf8");
      const content = partBuf.slice(headerEnd + 4);

      const disposition = /content-disposition:([^\r\n]*)/i.exec(headers)?.[1] || "";
      const nameMatch = /name="([^"]*)"/i.exec(disposition);
      const fileNameMatch = /filename="([^"]*)"/i.exec(disposition);
      const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headers);

      parts.push({
        fieldName: nameMatch ? nameMatch[1] : "",
        fileName: fileNameMatch ? fileNameMatch[1] : null,
        contentType: typeMatch ? typeMatch[1].trim() : "",
        content,
      });
    }

    start = next + delimiter.length;
  }

  const filePart = parts.find((p) => p.fileName !== null && p.content.length > 0);
  if (!filePart) return null;

  const fields = {};
  parts
    .filter((p) => p.fileName === null && p.fieldName)
    .forEach((p) => {
      fields[p.fieldName] = p.content.toString("utf8").trim();
    });

  return { filePart, fields };
};

const singleImageUpload = async (req, res, next) => {
  try {
    const contentType = req.headers["content-type"] || "";

    // --- JSON base64 path ---
    if (contentType.includes("application/json")) {
      // express.json() has already consumed and parsed the body.
      const { fileName, fileBase64 } = req.body || {};
      if (!fileBase64) return next(createHttpError(400, "No image file provided."));

      const base64 = String(fileBase64).replace(/^data:[^;]+;base64,/, "");
      const buffer = Buffer.from(base64, "base64");
      if (buffer.length > MAX_FILE_BYTES) {
        return next(createHttpError(413, "File is too large. Maximum size is 5MB."));
      }

      req.uploadedFile = { buffer, fileName: fileName || "upload", declaredMimeType: "" };
      return next();
    }

    // --- multipart path ---
    if (!contentType.includes("multipart/form-data")) {
      return next(createHttpError(400, "Expected a multipart/form-data image upload."));
    }

    const boundary = getBoundary(contentType);
    if (!boundary) return next(createHttpError(400, "Malformed upload request."));

    // +1KB headroom for the multipart envelope itself.
    const body = await readBody(req, MAX_FILE_BYTES + 1024);
    const parsed = parseMultipart(body, boundary);
    if (!parsed) return next(createHttpError(400, "No image file provided."));

    req.uploadedFile = {
      buffer: parsed.filePart.content,
      fileName: parsed.filePart.fileName || "upload",
      declaredMimeType: parsed.filePart.contentType,
    };
    // Non-file fields (altText, folder, ...) are merged into body for the
    // controller, matching how it would look with express.json().
    req.body = { ...(req.body || {}), ...parsed.fields };
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = { singleImageUpload, parseMultipart, getBoundary };
