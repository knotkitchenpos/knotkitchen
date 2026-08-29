const createHttpError = require("http-errors");

/**
 * Client for the partner onboarding portal (agreement.<domain>).
 *
 * The portal is a separate application with its own datastore — agreements
 * live in ITS database, not ours. Both run on the same internal Docker
 * network, so the default base URL is the compose service name and the
 * traffic never leaves the host.
 *
 * Auth is a shared service token sent as a header. The portal's own API is
 * session-authenticated for human agents; a service caller has no session, so
 * it needs a credential of its own. Without ONBOARD_SERVICE_TOKEN configured
 * this client refuses to call rather than attempting an unauthenticated
 * request that would either fail or, worse, succeed against an unprotected
 * endpoint.
 */
const baseUrl = () =>
  (process.env.ONBOARD_BASE_URL || "http://onboard-portal:3000").replace(/\/$/, "");

const serviceToken = () => process.env.ONBOARD_SERVICE_TOKEN || "";

const REQUEST_TIMEOUT_MS = 8000;

const request = async (path, { method = "GET", body } = {}) => {
  const token = serviceToken();
  if (!token) {
    throw createHttpError(
      503,
      "The onboarding portal connection is not configured on this server."
    );
  }

  // Don't let a hung portal hold a CSD request open indefinitely.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-service-token": token,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw createHttpError(504, "The onboarding portal did not respond in time.");
    }
    throw createHttpError(502, "Could not reach the onboarding portal.");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    throw createHttpError(502, "The onboarding portal rejected this server's credentials.");
  }
  if (res.status === 404) throw createHttpError(404, "Agreement not found in the onboarding portal.");
  if (!res.ok) throw createHttpError(502, `The onboarding portal returned an error (${res.status}).`);

  try {
    return await res.json();
  } catch {
    throw createHttpError(502, "The onboarding portal returned a malformed response.");
  }
};

const listAgreements = async () => {
  const json = await request("/api/agreements");
  // The portal returns agreements as an object keyed by id, not an array.
  const raw = json?.agreements || {};
  return Array.isArray(raw) ? raw : Object.values(raw);
};

const getAgreement = async (id) => {
  const json = await request(`/api/agreements/${encodeURIComponent(id)}`);
  if (!json?.agreement) throw createHttpError(404, "Agreement not found in the onboarding portal.");
  return json.agreement;
};

/**
 * Tell the portal a store now exists for this agreement.
 * Best-effort by contract — callers must not fail store creation on this.
 */
const markStoreCreated = async (id, { storeId, storeCreatedAt, by }) =>
  request(`/api/agreements/${encodeURIComponent(id)}/store-created`, {
    method: "POST",
    body: { storeId, storeCreatedAt, by },
  });

/**
 * Fetch one uploaded file from the portal as bytes.
 *
 * The portal's `/uploads` is session-protected (it holds customer KYC), so
 * this sends the service token too. Returns the raw bytes rather than a URL
 * because the caller stores its own copy — see csdDocumentController for why
 * referencing the portal's copy would be wrong.
 *
 * Capped: the portal is a trusted peer, but a corrupt or hostile response
 * must not be able to exhaust this process's memory.
 */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const fetchFile = async (fileUrl) => {
  const token = serviceToken();
  if (!token) throw createHttpError(503, "The onboarding portal connection is not configured.");

  // Only ever fetch from the configured portal — never follow a path from the
  // agreement to some other host.
  const url = fileUrl.startsWith("http") ? fileUrl : `${baseUrl()}${fileUrl.startsWith("/") ? "" : "/"}${fileUrl}`;
  if (!url.startsWith(baseUrl())) {
    throw createHttpError(400, "That document is not hosted on the onboarding portal.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  let res;
  try {
    res = await fetch(url, { headers: { "x-service-token": token }, signal: controller.signal });
  } catch (err) {
    throw createHttpError(
      err.name === "AbortError" ? 504 : 502,
      "Could not download the document from the onboarding portal."
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw createHttpError(502, `The onboarding portal returned ${res.status} for a document.`);
  }

  const declared = Number(res.headers.get("content-length") || 0);
  if (declared && declared > MAX_FILE_BYTES) {
    throw createHttpError(413, "That document is larger than 20 MB.");
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_FILE_BYTES) {
    throw createHttpError(413, "That document is larger than 20 MB.");
  }

  return { buffer, contentType: res.headers.get("content-type") || "" };
};

const isConfigured = () => Boolean(serviceToken());

module.exports = { listAgreements, getAgreement, markStoreCreated, fetchFile, isConfigured, baseUrl };
