import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// A scratch database and upload folder; set before the server is loaded.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kkagr-"));
process.env.ONBOARD_DB_PATH = path.join(dir, "database.json");
process.env.ONBOARD_UPLOADS_DIR = path.join(dir, "uploads");
process.env.AGENT_JWT_SECRET = "t".repeat(48);
fs.writeFileSync(process.env.ONBOARD_DB_PATH, JSON.stringify({ agents: [], agreements: {} }));

const require = createRequire(import.meta.url);
const jwt = require("jsonwebtoken");
const app = require("../server/server.js");

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const cookie = (role) => `kk_session=${jwt.sign({ username: role, name: role, role }, process.env.AGENT_JWT_SECRET)}`;
const AGENT = cookie("agent");
const ADMIN = cookie("admin");

async function call(method, url, body, who = AGENT) {
  const res = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", cookie: who },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const save = (body, who) => call("POST", "/agreements", body, who);

const PDF = Buffer.from("%PDF-1.4 signed copy");
const pdfFile = (buf = PDF) => ({ name: "signed.pdf", dataUrl: "data:application/pdf;base64," + buf.toString("base64") });
const TEXT = "# Agreement\n**Agreement Version:** v3.0\\\nbody";
const ACCEPT = { accept_accurate: true, accept_authorised: true, accept_terms: true, accept_wallet: true, accept_signed: true };
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");

let seq = 0;
const draft = (over = {}) => ({
  id: `KK-AGR-TEST-${++seq}`,
  status: "Draft",
  data: { o_name: "Owner", sign_method: "aadhaar-esign", ...ACCEPT },
  files: {},
  agreement_text: TEXT,
  esigned_text_hash: hash(TEXT),
  ...over,
});

async function submitted() {
  const ag = draft({ status: "Submitted", files: { esigned: pdfFile() } });
  const r = await save(ag);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // What the portal sends next: the server's url instead of the data URL.
  ag.files = { esigned: { name: "signed.pdf", url: r.body.agreement.files.esigned.url } };
  return { ag, saved: r.body.agreement };
}

test("drafts save as before, and a stored file comes back as a url", async () => {
  const ag = draft({ files: { doc_pan: pdfFile() } });
  let r = await save(ag);
  assert.equal(r.status, 200);
  assert.equal(r.body.agreement.status, "Draft");
  assert.equal(r.body.agreement.files.doc_pan.url, `/uploads/${ag.id}/doc_pan.pdf`);
  r = await save({ ...ag, status: "eSigned", files: { doc_pan: r.body.agreement.files.doc_pan, esigned: pdfFile() } });
  assert.equal(r.status, 200);
  assert.equal(r.body.agreement.status, "eSigned");
  assert.ok(r.body.agreement.files.doc_pan && r.body.agreement.files.esigned);
  assert.equal(r.body.agreement.acceptance.submittedAt, undefined, "no acceptance before submission");
});

test("the client can set only Draft, eSigned and Submitted", async () => {
  for (const status of ["Completed", "Store Created", "Approved"]) {
    const r = await save(draft({ status, files: { esigned: pdfFile() } }));
    assert.equal(r.status, 400, status);
    assert.equal(r.body.code, "STATUS_NOT_ALLOWED");
  }
});

test("a signature method outside the three is refused; a missing one defaults to handwritten-scanned", async () => {
  let r = await save(draft({ data: { sign_method: "thumbprint" } }));
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "SIGN_METHOD_INVALID");
  r = await save(draft({ status: "Submitted", data: { ...ACCEPT }, files: { esigned: pdfFile() } }));
  assert.equal(r.status, 200);
  assert.equal(r.body.agreement.acceptance.signatureMethod, "handwritten-scanned");
});

test("submission needs the signed copy and all five acceptance statements", async () => {
  let r = await save(draft({ status: "Submitted" }));
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "ESIGNED_REQUIRED");

  r = await save(draft({ status: "Submitted", files: { esigned: pdfFile() }, data: { ...ACCEPT, accept_wallet: false } }));
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "ACCEPTANCE_REQUIRED");
  assert.deepEqual(r.body.missing, ["accept_wallet"]);

  // A url that is not this agreement's own file does not count as a signed copy.
  const other = draft({ status: "Submitted", files: { esigned: { name: "x.pdf", url: "/uploads/KK-AGR-TEST-1/doc_pan.pdf" } } });
  r = await save(other);
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "ESIGNED_REQUIRED");
});

test("submission records the acceptance: method, version and both hashes", async () => {
  const { saved } = await submitted();
  const a = saved.acceptance;
  assert.equal(saved.status, "Submitted");
  assert.equal(a.signatureMethod, "aadhaar-esign");
  assert.equal(a.agreementVersion, "v3.0");
  assert.equal(a.agreementHash, crypto.createHash("sha256").update(TEXT).digest("hex"));
  assert.equal(a.signedCopyHash, crypto.createHash("sha256").update(PDF).digest("hex"));
  assert.ok(a.submittedAt && a.agent && a.agent.username === "agent");
});

test("after submission a sales agent cannot change the text, the details or the signed copy", async () => {
  const { ag } = await submitted();
  let r = await save({ ...ag, agreement_text: TEXT + " edited" });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "AGREEMENT_LOCKED");
  r = await save({ ...ag, data: { ...ag.data, o_name: "Someone else" } });
  assert.equal(r.status, 409);
  r = await save({ ...ag, files: { esigned: pdfFile(Buffer.from("%PDF another")) } });
  assert.equal(r.status, 409);
  r = await save({ ...ag, files: { esigned: null } });
  assert.equal(r.status, 409, "removing the signed copy is a change too");
});

test("a file left out of a save is kept; an explicit null removes it", async () => {
  const ag = draft({ files: { doc_pan: pdfFile(), doc_bank: pdfFile() } });
  let r = await save(ag);
  assert.equal(r.status, 200);
  r = await save({ ...ag, files: { doc_bank: null } });
  assert.equal(r.status, 200);
  assert.ok(r.body.agreement.files.doc_pan, "left out: kept");
  assert.equal(r.body.agreement.files.doc_bank, undefined, "null: removed");
});

test("submission refuses an agreement that is not the current version", async () => {
  const old = "# Agreement\n**Agreement Version:** v2.1\\\nbody";
  const r = await save(draft({ status: "Submitted", files: { esigned: pdfFile() }, agreement_text: old, esigned_text_hash: hash(old) }));
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "AGREEMENT_OUTDATED");
});

test("submission refuses a signed copy uploaded against a different text", async () => {
  let r = await save(draft({ status: "Submitted", files: { esigned: pdfFile() }, esigned_text_hash: hash(TEXT + " before the edit") }));
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "SIGNED_TEXT_MISMATCH");
  r = await save(draft({ status: "Submitted", files: { esigned: pdfFile() }, esigned_text_hash: undefined }));
  assert.equal(r.body.code, "SIGNED_TEXT_MISMATCH", "no hash at all");
});

test("an admin replacing a submitted signed copy keeps the old file and records it", async () => {
  const { ag, saved } = await submitted();
  const NEW = Buffer.from("%PDF-1.4 corrected signed copy");
  const r = await save({ ...ag, files: { esigned: pdfFile(NEW) } }, ADMIN);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const a = r.body.agreement.acceptance;
  assert.equal(r.body.agreement.files.esigned.url, `/uploads/${ag.id}/esigned.pdf`);
  assert.equal(a.signedCopyHash, hash(NEW));
  assert.equal(a.submittedAt, saved.acceptance.submittedAt);
  assert.equal(a.history.length, 1);
  const h = a.history[0];
  assert.equal(h.previousSignedCopyHash, saved.acceptance.signedCopyHash);
  assert.equal(h.by.username, "admin");
  assert.match(h.previousSignedCopy.url, new RegExp(`^/uploads/${ag.id}/esigned-\\d{8}T\\d{9}Z\\.pdf$`));
  const uploads = process.env.ONBOARD_UPLOADS_DIR;
  assert.deepEqual(fs.readFileSync(path.join(uploads, ag.id, path.basename(h.previousSignedCopy.url))), PDF, "old bytes kept");
  assert.deepEqual(fs.readFileSync(path.join(uploads, ag.id, "esigned.pdf")), NEW);

  // Re-sending the same replacement changes nothing more.
  const again = await save({ ...ag, files: { esigned: pdfFile(NEW) } }, ADMIN);
  assert.equal(again.body.agreement.acceptance.history.length, 1);
});

test("an unchanged re-save after submission is accepted and never moves the status back", async () => {
  const { ag, saved } = await submitted();
  let r = await save(ag);
  assert.equal(r.status, 200);
  // The same bytes re-sent as a data URL (an older tab) are also unchanged.
  r = await save({ ...ag, status: "eSigned", files: { esigned: pdfFile() } });
  assert.equal(r.status, 200);
  assert.equal(r.body.agreement.status, "Submitted");
  assert.deepEqual(r.body.agreement.acceptance, saved.acceptance, "acceptance is never rewritten");
});

test("store-created survives a later save; only that route sets it", async () => {
  const { ag } = await submitted();
  let r = await call("POST", `/agreements/${ag.id}/store-created`, { storeId: "S-1" });
  assert.equal(r.status, 200);
  r = await save({ ...ag, status: "Submitted" });
  assert.equal(r.status, 200);
  assert.equal(r.body.agreement.status, "Store Created");
  assert.equal(r.body.agreement.storeId, "S-1");
});

test("an admin may still correct a submitted agreement", async () => {
  const { ag } = await submitted();
  const r = await save({ ...ag, data: { ...ag.data, o_name: "Corrected" } }, ADMIN);
  assert.equal(r.status, 200);
  assert.equal(r.body.agreement.data.o_name, "Corrected");
  assert.equal(r.body.agreement.status, "Submitted");
});

test("a sales agent cannot delete a submitted agreement or its signed copy; an admin can", async () => {
  const { ag } = await submitted();
  let r = await call("DELETE", `/agreements/${ag.id}/files/esigned`);
  assert.equal(r.status, 403);
  r = await call("DELETE", `/agreements/${ag.id}`);
  assert.equal(r.status, 403);
  r = await call("DELETE", `/agreements/${ag.id}/files/esigned`, null, ADMIN);
  assert.equal(r.status, 200);
  r = await call("DELETE", `/agreements/${ag.id}`, null, ADMIN);
  assert.equal(r.status, 200);

  // A draft is still the agent's to throw away (the portal's Reset button).
  const d = draft();
  await save(d);
  r = await call("DELETE", `/agreements/${d.id}`);
  assert.equal(r.status, 200);
});
