/**
 * CSD sections a staff member can be limited to (owner, 2026-11-12: finer
 * permissions, e.g. a Sales person who cannot see Billing).
 *
 * Permissions only ever RESTRICT. Role stays the primary check:
 *   - an admin always has everything;
 *   - a staff member with no sections set has every staff section, which is
 *     exactly what they had before this existed;
 *   - a staff member with sections set has only those.
 * Nothing here can give a staff member an admin-only action: those routes
 * still carry requireCsdAdmin.
 */
const SECTIONS = [
  { key: "stores", label: "Store Management" },
  { key: "search", label: "Search Console" },
  { key: "chat", label: "Team chat" },
  { key: "whatsapp", label: "WhatsApp inbox" },
  { key: "jobs", label: "Jobs" },
  { key: "hardware", label: "Hardware requests" },
  { key: "eats", label: "Knot Eats" },
  { key: "devices", label: "Device management" },
  { key: "health", label: "Store Health" },
  { key: "knowledge", label: "Knowledge base" },
  { key: "billing", label: "Billing details (plan, wallet)" },
];

const KEYS = new Set(SECTIONS.map((s) => s.key));

/** Only real section names, once each. Anything else in an old row is ignored. */
const knownSections = (permissions) => [...new Set((permissions || []).map((p) => String(p).trim()).filter((p) => KEYS.has(p)))];

const hasSection = (staff, section) => {
  if (!staff) return false;
  if (staff.role === "admin") return true;
  const mine = knownSections(staff.permissions);
  return mine.length === 0 || mine.includes(section);
};

/**
 * Which section guards which API path (relative to /api/csd). One table in
 * front of every route, so a new route under these paths cannot forget it.
 * First match wins.
 */
const PATH_SECTIONS = [
  // The inbox's assign menu needs the staff names, without needing Jobs.
  { path: /^\/jobs\/meta\/assignees$/, any: ["jobs", "whatsapp"] },
  { path: /^\/stores(\/|$)/, any: ["stores"] },
  { path: /^\/restaurants(\/|$)/, any: ["stores"] },
  { path: /^\/orders(\/|$)/, any: ["search"] },
  { path: /^\/jobs(\/|$)/, any: ["jobs"] },
  { path: /^\/chat(\/|$)/, any: ["chat"] },
  { path: /^\/whatsapp(\/|$)/, any: ["whatsapp"] },
  { path: /^\/billing(\/|$)/, any: ["billing"] },
  { path: /^\/hardware-requests(\/|$)/, any: ["hardware"] },
  { path: /^\/knot-eats(\/|$)/, any: ["eats"] },
  { path: /^\/kkmdm\/sso(\/|$)/, any: ["devices"] },
  { path: /^\/health(\/|$)/, any: ["health"] },
  // Quick replies are read from inside the WhatsApp inbox.
  { path: /^\/knowledge\/quick-replies$/, any: ["knowledge", "whatsapp"] },
  { path: /^\/knowledge(\/|$)/, any: ["knowledge"] },
];

const sectionsForPath = (path) => PATH_SECTIONS.find((r) => r.path.test(path))?.any || null;

module.exports = { SECTIONS, knownSections, hasSection, sectionsForPath };
