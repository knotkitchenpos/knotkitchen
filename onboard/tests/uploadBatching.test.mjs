import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
const apiJs = fs.readFileSync(path.join(__dirname, "..", "public", "js", "api.js"), "utf8");

// saveAgreementToDb as the page defines it, run against a fake server.
function loadSave(respond) {
  const src = html.slice(html.indexOf("async function saveAgreementToDb"), html.indexOf("async function generateUniqueAgreementId"));
  const requests = [];
  const apiClient = {
    saveAgreement: async (p) => {
      requests.push(p);
      return respond(p, requests.length);
    },
  };
  const make = new Function("apiClient", "window", "currentUser", "todayStr", "getAgreementsDb", "storageHelper", "STORAGE_AGREEMENTS", `${src}; return saveAgreementToDb;`);
  const save = make(apiClient, { AGREEMENT_VERSION: "v3" }, null, () => "2026-09-28", async () => ({}), { set: async () => {} }, "k");
  return { save, requests };
}

const storeAll = (p) => ({
  success: true,
  agreement: { files: Object.fromEntries(Object.entries(p.files).map(([k, f]) => [k, f && { url: `/uploads/A/${k}` }])) },
});

const pendingIn = (p) => Object.keys(p.files).filter((k) => p.files[k] && p.files[k].dataUrl);

test("each save request carries at most one new upload, and submit goes last", async () => {
  const { save, requests } = loadSave(storeAll);
  const st = {
    agreement: { id: "A", text: "t" },
    data: {},
    submitted: true,
    status: "Submitted",
    files: {
      pan: { name: "p.webp", dataUrl: "data:x" },
      fssai: { name: "f.webp", dataUrl: "data:y" },
      logo: { name: "l.webp", url: "/uploads/A/logo" },
      esigned: { name: "s.pdf", dataUrl: "data:z" },
    },
  };
  const res = await save(st);
  assert.strictEqual(res.success, true);
  assert.strictEqual(requests.length, 3);
  for (const p of requests) assert.ok(pendingIn(p).length <= 1);
  assert.deepStrictEqual(requests.map((p) => p.status), ["eSigned", "eSigned", "Submitted"]);
  // The final (submit) request holds every file, all already on the server but one.
  assert.deepStrictEqual(Object.keys(requests[2].files).sort(), ["esigned", "fssai", "logo", "pan"]);
  assert.ok(Object.values(st.files).every((f) => f.url && !f.dataUrl));
});

test("a failed request stops the follow-ups", async () => {
  const { save, requests } = loadSave(() => ({ success: false, message: "no" }));
  const st = { agreement: { id: "A" }, data: {}, files: { a: { dataUrl: "d1" }, b: { dataUrl: "d2" } } };
  const res = await save(st);
  assert.strictEqual(res.success, false);
  assert.strictEqual(requests.length, 1);
});

test("a file the server did not store is not resent in a loop", async () => {
  const { save, requests } = loadSave(() => ({ success: true, agreement: { files: {} } }));
  const st = { agreement: { id: "A" }, data: {}, files: { a: { dataUrl: "d1" }, b: { dataUrl: "d2" } } };
  await save(st);
  assert.strictEqual(requests.length, 2);
});

test("uploads queue behind one already in flight, and 413 gets a plain message", () => {
  const handle = html.slice(html.indexOf("async function handleFile"), html.indexOf("/* ============ STEP RENDERERS"));
  assert.match(handle, /uploadSave = \(uploadSave \|\| Promise\.resolve\(\)\)\.then\(saveNow\)/);
  assert.match(apiJs, /res\.status === 413/);
  assert.match(apiJs, /The files are too large to send together\. Retry, or upload them one at a time\./);
});
