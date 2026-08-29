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

const isConfigured = () => Boolean(serviceToken());

module.exports = { listAgreements, getAgreement, markStoreCreated, isConfigured, baseUrl };
