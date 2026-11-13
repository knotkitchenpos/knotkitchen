const createHttpError = require("http-errors");
const { readSession, linkFor, ownerForLink } = require("../services/partners");

/**
 * Partners dashboard -> one linked store's Billing and Reports.
 *
 *   /api/partners/s/<storeId>/api/subscription  ->  /api/subscription
 *
 * Billing and Reports moved out of the POS into the Partners dashboard; rather
 * than a second copy of every billing route, the dashboard calls the store's
 * own API through here. It runs at app level, before any route, so the
 * request is then handled by the store's routes exactly as the POS's would
 * be, with this store's Owner as req.user (middlewares/tokenVerification
 * reads req.partnerActingUser). The account lock and plan gate still apply.
 *
 * Only the paths below, with these methods, may pass: Billing, Reports and
 * read-only orders, Manage Menu, Inventory, Manage Staff, Help & Support.
 * Everything else of the store's API (taking and changing orders, tables,
 * store settings, device and website settings) stays the POS's alone.
 */
const ALLOW = [
  // Billing & Subscription
  ["GET", /^\/api\/subscription(\/(quote|invoices|hardware-requests))?$/],
  ["POST", /^\/api\/subscription\/(plan|addons|printers|renew|cancel|reinstate)$/],
  ["POST", /^\/api\/subscription\/hardware-requests\/[^/]+\/cancel$/],
  ["DELETE", /^\/api\/subscription\/addons\/[^/]+$/],
  ["GET", /^\/api\/business-balance(\/transactions)?$/],
  ["POST", /^\/api\/business-balance\/recharge(\/verify)?$/],
  // What the Billing and Reports screens show about the store
  ["GET", /^\/api\/restaurant\/(me|properties)$/],
  ["GET", /^\/api\/website\/settings$/],
  // Reports and orders, read only
  ["GET", /^\/api\/order\/report(\/export)?$/],
  ["GET", /^\/api\/order$/],
  ["GET", /^\/api\/order\/[a-f0-9]{24}$/i],
  // Manage Menu (the POS's screen, with its photos and CSV import/export)
  ...["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => [m, /^\/api\/menu(\/[^?]*)?$/]),
  ["GET", /^\/api\/media$/],
  ["POST", /^\/api\/media$/],
  ["PATCH", /^\/api\/media\/[^/]+$/],
  ["DELETE", /^\/api\/media\/[^/]+$/],
  // Inventory Management
  ...["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => [m, /^\/api\/inventory(\/[^?]*)?$/]),
  // Manage Staff (deleting staff or changing a role still asks for the typed Store PIN)
  ["GET", /^\/api\/restaurant\/staff$/],
  ["POST", /^\/api\/restaurant\/staff$/],
  ["PUT", /^\/api\/restaurant\/staff\/[^/]+$/],
  ["DELETE", /^\/api\/restaurant\/staff\/[^/]+$/],
  // Store hours across stores: opening hours, holidays, Close for today
  ["PUT", /^\/api\/restaurant\/(timings|holidays|closed-for-today)$/],
  // The Security PIN popup those screens raise, and Help & Support
  ["POST", /^\/api\/restaurant\/verify-pin$/],
  ["POST", /^\/api\/support\/requests$/],
];

const PREFIX = /^\/api\/partners\/s\/([^/]+)(\/api\/[^?]*)(\?.*)?$/;

const allowed = (method, path) => ALLOW.some(([m, re]) => m === method && re.test(path));

const partnerPassthrough = async (req, res, next) => {
  const m = PREFIX.exec(req.url);
  if (!m) return next();
  try {
    const [, storeId, path, query = ""] = m;
    if (path.includes("..") || /%2e|%2f/i.test(path)) return next(createHttpError(404, "Not found."));
    if (!allowed(req.method, path)) return next(createHttpError(404, "Not found."));
    const found = await readSession(req);
    if (!found) return next(createHttpError(401, "Please sign in to the Partners dashboard.", { code: "PARTNER_SIGNED_OUT" }));
    const link = await linkFor(found.partner, storeId);
    const owner = await ownerForLink(link);
    req.partner = found.partner;
    req.partnerActingUser = owner;
    // The store's own route takes it from here.
    req.url = `${path}${query}`;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { partnerPassthrough, ALLOW, allowed };
