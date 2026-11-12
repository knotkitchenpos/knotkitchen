/**
 * What changed between two settings snapshots, for the audit log.
 *
 * "Website Configuration Changed" used to store the whole settings object
 * twice (before and after, ~23 KB per save), which made it the largest thing
 * in the audit log by far. This keeps only the fields that changed:
 *   [{ field: "ordering.minOrderConfig.delivery.amount", before: 199, after: 249 }, ...]
 * (a list, not an object keyed by path: field names with dots are best kept
 * out of stored documents).
 * Arrays are compared whole. Each value is capped, and so is the number of
 * fields, so one save can never write a huge entry again.
 */
const MAX_FIELDS = 60;
const MAX_VALUE_CHARS = 1500;

const isPlain = (v) => v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !(v?._bsontype);
const norm = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const capped = (v) => {
  const s = JSON.stringify(v);
  if (s === undefined || s.length <= MAX_VALUE_CHARS) return v;
  return `${s.slice(0, MAX_VALUE_CHARS)}… (${s.length} chars)`;
};

const changedFields = (prev, next) => {
  const changes = [];
  let count = 0;
  let more = 0;
  const walk = (a, b, path) => {
    if (isPlain(a) && isPlain(b)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (k === "updatedAt" || k === "__v") continue;
        walk(a[k], b[k], path ? `${path}.${k}` : k);
      }
      return;
    }
    if (JSON.stringify(norm(a)) === JSON.stringify(norm(b))) return;
    if (count >= MAX_FIELDS) { more += 1; return; }
    count += 1;
    changes.push({ field: path || "(all)", before: capped(norm(a)), after: capped(norm(b)) });
  };
  walk(norm(prev), norm(next), "");
  return { changes, more };
};

module.exports = { changedFields };
