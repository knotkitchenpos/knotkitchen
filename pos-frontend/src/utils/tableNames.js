/**
 * The name to offer after a table is created, so a floor is set up one name
 * at a time without retyping (owner, 2026-10-29): the number at the end goes
 * up by one, keeping its zeros. "T1" -> "T2", "GF-T9" -> "GF-T10",
 * "VIP-01" -> "VIP-02". A name with no number at the end is offered as it was,
 * selected, to type over.
 */
export const nextTableName = (name) => {
  const s = String(name || "").trim();
  const m = /^(.*?)(\d+)$/.exec(s);
  if (!m) return s;
  const n = String(Number(m[2]) + 1);
  return m[1] + n.padStart(m[2].length, "0");
};
