const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mapAgreementToStore, parseDate, isYes } = require("../services/agreementMapper");

/**
 * The agreement portal and the POS were built separately and name the same
 * things differently, so this mapping is where a mistake would be silent —
 * a store created with the wrong phone number or an FSSAI date read as the
 * wrong month looks perfectly fine until someone checks.
 */

const agreement = (data, top = {}) => ({ id: "KK-AGR-1", status: "Completed", data, ...top });

const complete = {
  r_display: "Spice Garden", r_name: "Spice Garden Pvt",
  r_address: "12 Park Street", r_city: "Kolkata", r_state: "West Bengal", r_pin: "700016",
  r_phone: "9812345670", r_email: "hello@spice.example", r_maps: "https://maps.google.com/?q=1",
  r_type: "Casual Dining",
  o_name: "Ravi Kumar", o_phone: "9812345671", o_email: "Ravi@Example.COM",
  b_legalname: "Spice Garden Pvt Ltd", b_gst: "Yes", b_gstin: "19abcde1234f1z5",
  b_fssai: "12345678901234", b_fssai_valid: "2030-01-01",
  sales_agent: "Priya Nair",
};

test("maps a complete agreement with nothing missing", () => {
  const { values, missing, warnings } = mapAgreementToStore(agreement(complete));
  assert.deepEqual(missing, []);
  assert.deepEqual(warnings, []);
  assert.equal(values.restaurantName, "Spice Garden");
  assert.equal(values.city, "Kolkata");
  assert.equal(values.postalCode, "700016");
  assert.equal(values.ownerPhone, "9812345671");
  assert.equal(values.salesAgentName, "Priya Nair");
});

test("normalises case on identifiers and email", () => {
  const { values } = mapAgreementToStore(agreement(complete));
  assert.equal(values.gstin, "19ABCDE1234F1Z5", "GSTIN is upper-cased");
  assert.equal(values.ownerEmail, "ravi@example.com", "email is lower-cased");
});

test("prefers the display name but falls back to the legal name", () => {
  const { values } = mapAgreementToStore(agreement({ ...complete, r_display: "" }));
  assert.equal(values.restaurantName, "Spice Garden Pvt");
});

test("falls back to the agreement's top-level fields when data is bare", () => {
  const { values } = mapAgreementToStore(
    agreement({}, { r_name: "Top Level Diner", o_name: "Top Owner", sales_agent: "Agent X" })
  );
  assert.equal(values.restaurantName, "Top Level Diner");
  assert.equal(values.salesAgentName, "Agent X");
});

test("reports every missing required field, not just the first", () => {
  const { missing } = mapAgreementToStore(agreement({ r_display: "Only A Name" }));
  for (const f of ["Address", "City", "State", "PIN code", "Owner name", "Owner phone"]) {
    assert.ok(missing.includes(f), `expected "${f}" in ${JSON.stringify(missing)}`);
  }
});

test("strips phone formatting and keeps the last 10 digits", () => {
  const { values } = mapAgreementToStore(
    agreement({ ...complete, o_phone: "+91 98123-45671", r_phone: "091 9812345670" })
  );
  assert.equal(values.ownerPhone, "9812345671");
  assert.equal(values.restaurantPhone, "9812345670");
});

test("a PIN code that isn't 6 digits is rejected, not silently truncated", () => {
  const { values, missing } = mapAgreementToStore(agreement({ ...complete, r_pin: "70001" }));
  assert.ok(missing.includes("PIN code"));
  assert.equal(values.postalCode, "");
});

test("a PIN code starting with 0 is rejected (not a valid Indian PIN)", () => {
  const { missing } = mapAgreementToStore(agreement({ ...complete, r_pin: "070016" }));
  assert.ok(missing.includes("PIN code"));
});

test("day-first dates are not misread as month-first", () => {
  // 03/04/2027 must be 3 April, not 4 March — new Date() would get this wrong.
  const d = parseDate("03/04/2027");
  assert.equal(d.getUTCMonth(), 3, "month should be April (index 3)");
  assert.equal(d.getUTCDate(), 3);

  const dash = parseDate("15-08-2029");
  assert.equal(dash.getUTCDate(), 15);
  assert.equal(dash.getUTCMonth(), 7);
});

test("ISO dates still parse", () => {
  assert.equal(parseDate("2030-01-01").getUTCFullYear(), 2030);
});

test("an unparseable expiry warns instead of inventing a date", () => {
  const { values, warnings } = mapAgreementToStore(agreement({ ...complete, b_fssai_valid: "soon" }));
  assert.equal(values.fssaiValidUntil, "");
  assert.ok(warnings.some((w) => /expiry date could not be understood/i.test(w)));
});

test("an already-expired FSSAI licence is flagged", () => {
  const { warnings } = mapAgreementToStore(agreement({ ...complete, b_fssai_valid: "2020-01-01" }));
  assert.ok(warnings.some((w) => /already expired/i.test(w)));
});

test("yes/no answers are read in all the forms the portal writes", () => {
  for (const v of ["Yes", "yes", "TRUE", "1", "y", true]) assert.equal(isYes(v), true, String(v));
  for (const v of ["No", "no", "0", "", null, undefined, false]) assert.equal(isYes(v), false, String(v));
});

test("a GSTIN present without the checkbox is trusted, and warned about", () => {
  const { values, warnings } = mapAgreementToStore(
    agreement({ ...complete, b_gst: "No", b_gstin: "19ABCDE1234F1Z5" })
  );
  assert.equal(values.gstRegistered, true, "a GSTIN is not entered by accident");
  assert.ok(warnings.some((w) => /GSTIN is present/i.test(w)));
});

test("claiming GST registration without a GSTIN warns", () => {
  const { warnings } = mapAgreementToStore(agreement({ ...complete, b_gstin: "" }));
  assert.ok(warnings.some((w) => /no GSTIN/i.test(w)));
});

test("a malformed FSSAI number is dropped with a warning, not stored", () => {
  const { values, warnings } = mapAgreementToStore(agreement({ ...complete, b_fssai: "123" }));
  assert.equal(values.fssaiNumber, "");
  assert.ok(warnings.some((w) => /FSSAI number is not 14 digits/i.test(w)));
});

test("a non-URL maps link is dropped with a warning", () => {
  const { values, warnings } = mapAgreementToStore(agreement({ ...complete, r_maps: "near the park" }));
  assert.equal(values.mapsLink, "");
  assert.ok(warnings.some((w) => /Maps link/i.test(w)));
});

test("missing fields and warnings are different things", () => {
  // A bad maps link must NOT block store creation; a missing city must.
  const bad = mapAgreementToStore(agreement({ ...complete, r_maps: "nope" }));
  assert.deepEqual(bad.missing, []);
  assert.ok(bad.warnings.length > 0);

  const blocked = mapAgreementToStore(agreement({ ...complete, r_city: "" }));
  assert.ok(blocked.missing.includes("City"));
});

test("an empty agreement does not throw", () => {
  const { missing } = mapAgreementToStore({});
  assert.ok(missing.length > 0);
});

/**
 * Status-vocabulary tests, added after reading the real onboarding portal.
 *
 * The portal's vocabulary is Draft → eSigned → Submitted; a finished agreement
 * ends as "Submitted" (index.html: `state.status = 'Submitted'`). CSD had been
 * written against a mock that used "Completed", so with the real portal it
 * would have listed zero agreements and refused every store creation.
 */
const { isCompleted } = require("../controllers/csdAgreementController");

test("REGRESSION: 'Submitted' is what the real portal actually sets", () => {
  assert.ok(isCompleted({ status: "Submitted" }));
  assert.ok(isCompleted({ status: "submitted" }), "matching must be case-insensitive");
});

test("the other done-ish statuses the portal UI renders are accepted", () => {
  for (const s of ["Completed", "Signed", "Store Created"]) {
    assert.ok(isCompleted({ status: s }), `${s} should be accepted`);
  }
});

test("'eSigned' is NOT enough to create a store", () => {
  // The portal explicitly warns that an uploaded PDF is not treated as
  // verified until staff confirm it — the agreement is not yet submitted.
  assert.ok(!isCompleted({ status: "eSigned" }));
  assert.ok(!isCompleted({ status: "Draft" }));
  assert.ok(!isCompleted({ status: "" }));
  assert.ok(!isCompleted({}));
  assert.ok(!isCompleted(null));
});
