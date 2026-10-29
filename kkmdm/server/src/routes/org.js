const express = require("express");
const { Store, Group, Policy, PolicyAssignment, Device, Company } = require("../models");
const { wrap, HttpError, escapeRegex } = require("../lib/http");
const { requirePerm, scopeFilter } = require("../lib/adminAuth");
const { DEFAULT_SETTINGS, deepMerge } = require("../lib/policy");
const { syncStores } = require("../lib/storeSync");
const { audit } = require("../lib/audit");
const push = require("../lib/push");

const router = express.Router();
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Wakes every device a policy change may reach so it re-syncs. */
async function wakeScope(scope, targetId) {
  const q = scope === "company" ? { companyId: targetId } : scope === "store" ? { storeId: targetId }
    : scope === "group" ? { groupId: targetId } : { _id: targetId };
  const ds = await Device.find({ ...q, lifecycle: { $ne: "retired" } }, { _id: 1 }).lean();
  ds.forEach((d) => push.wake(d._id));
  return ds.length;
}

// ---------------- Stores ----------------

router.get("/stores", requirePerm("devices.view"), wrap(async (req, res) => {
  const q = { archived: { $ne: true } };
  if (req.admin.role === "store_user") q._id = { $in: req.admin.storeIds };
  if (req.query.q) q.name = new RegExp(escapeRegex(req.query.q), "i");
  // status=active: what CSD lists as active (stores added by hand, without a KK ID, count as active).
  if (req.query.status === "active") q.$or = [{ kkStatus: "active" }, { kkStoreId: { $in: [null, ""] } }];
  else if (req.query.status) q.kkStatus = String(req.query.status);
  const stores = await Store.find(q).sort({ name: 1 }).limit(1000).lean();
  const counts = await Device.aggregate([
    { $match: { lifecycle: { $ne: "retired" }, storeId: { $in: stores.map((s) => s._id) } } },
    { $group: { _id: "$storeId", total: { $sum: 1 }, online: { $sum: { $cond: ["$online", 1, 0] } } } },
  ]);
  const byStore = new Map(counts.map((c) => [String(c._id), c]));
  const assignments = await PolicyAssignment.find({ scope: "store", targetId: { $in: stores.map((s) => s._id) } }).populate("policyId", "name").lean();
  const policyByStore = new Map(assignments.map((a) => [String(a.targetId), a.policyId]));
  res.json({
    items: stores.map((s) => ({
      ...s,
      devices: byStore.get(String(s._id))?.total || 0,
      online: byStore.get(String(s._id))?.online || 0,
      policy: policyByStore.get(String(s._id)) || null,
    })),
  });
}));

router.post("/stores", requirePerm("stores.edit"), wrap(async (req, res) => {
  const company = await Company.findOne().sort({ createdAt: 1 });
  const { name, kkStoreId } = req.body;
  if (!name) throw new HttpError(400, "name_required");
  if (kkStoreId && !/^\d{6}$/.test(kkStoreId)) throw new HttpError(400, "kk_store_id_must_be_6_digits");
  const s = await Store.create({ companyId: req.admin.companyId || company._id, name, kkStoreId: kkStoreId || undefined });
  await audit(req, "store.created", { targetType: "store", targetId: s._id, details: { name, kkStoreId } });
  res.status(201).json({ store: s });
}));

router.patch("/stores/:id", requirePerm("stores.edit"), wrap(async (req, res) => {
  const s = await Store.findById(req.params.id);
  if (!s) throw new HttpError(404, "not_found");
  const b = req.body;
  if (b.name) s.name = b.name;
  for (const key of ["maintenanceWindow", "businessHours"]) {
    if (!b[key]) continue;
    const [a, z] = key === "maintenanceWindow" ? ["start", "end"] : ["open", "close"];
    if (!HHMM.test(b[key][a]) || !HHMM.test(b[key][z])) throw new HttpError(400, `${key}_must_be_HH:MM`);
    s[key] = { [a]: b[key][a], [z]: b[key][z] };
  }
  if (Array.isArray(b.appPins)) s.appPins = b.appPins.filter((p) => p.packageName && p.versionId);
  await s.save();
  await wakeScope("store", s._id);
  await audit(req, "store.updated", { targetType: "store", targetId: s._id, details: b });
  res.json({ store: s });
}));

router.post("/stores/sync", requirePerm("stores.edit"), wrap(async (req, res) => {
  const result = await syncStores();
  await audit(req, "store.sync", { details: result });
  res.json(result);
}));

// ---------------- Groups ----------------

router.get("/groups", requirePerm("devices.view"), wrap(async (req, res) => {
  const q = req.query.storeId ? { storeId: req.query.storeId } : {};
  if (req.admin.role === "store_user") q.storeId = { $in: req.admin.storeIds };
  res.json({ items: await Group.find(q).populate("storeId", "name").sort({ name: 1 }).lean() });
}));

router.post("/groups", requirePerm("groups.edit"), wrap(async (req, res) => {
  const store = await Store.findById(req.body.storeId);
  if (!store || !req.body.name) throw new HttpError(400, "store_and_name_required");
  const g = await Group.create({ companyId: store.companyId, storeId: store._id, name: req.body.name, description: req.body.description });
  await audit(req, "group.created", { targetType: "group", targetId: g._id, details: { name: g.name, store: store.name } });
  res.status(201).json({ group: g });
}));

router.patch("/groups/:id", requirePerm("groups.edit"), wrap(async (req, res) => {
  const g = await Group.findById(req.params.id);
  if (!g) throw new HttpError(404, "not_found");
  if (req.body.name) g.name = req.body.name;
  if (req.body.description !== undefined) g.description = req.body.description;
  await g.save();
  await audit(req, "group.updated", { targetType: "group", targetId: g._id, details: req.body });
  res.json({ group: g });
}));

router.delete("/groups/:id", requirePerm("groups.edit"), wrap(async (req, res) => {
  const g = await Group.findById(req.params.id);
  if (!g) throw new HttpError(404, "not_found");
  await Device.updateMany({ groupId: g._id }, { $unset: { groupId: 1 } });
  await PolicyAssignment.deleteMany({ scope: "group", targetId: g._id });
  await g.deleteOne();
  await audit(req, "group.deleted", { targetType: "group", targetId: g._id, details: { name: g.name } });
  res.json({ ok: true });
}));

// ---------------- Policies ----------------

router.get("/policies/defaults", requirePerm("policies.view"), (req, res) => res.json({ settings: DEFAULT_SETTINGS }));

router.get("/policies", requirePerm("policies.view"), wrap(async (req, res) => {
  const policies = await Policy.find(scopeFilter(req, { company: true })).sort({ name: 1 }).lean();
  const assignments = await PolicyAssignment.find({ policyId: { $in: policies.map((p) => p._id) } }).lean();
  res.json({
    items: policies.map((p) => ({ ...p, assignments: assignments.filter((a) => String(a.policyId) === String(p._id)) })),
  });
}));

router.get("/policies/:id", requirePerm("policies.view"), wrap(async (req, res) => {
  const p = await Policy.findById(req.params.id).lean();
  if (!p) throw new HttpError(404, "not_found");
  const assignments = await PolicyAssignment.find({ policyId: p._id }).lean();
  res.json({ policy: p, assignments, preview: deepMerge(DEFAULT_SETTINGS, p.settings) });
}));

/** Only known keys are kept, so a typo cannot silently do nothing. */
function cleanSettings(input, shape = DEFAULT_SETTINGS, path = "") {
  const out = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (!(k in shape)) {
      if (path === "managedConfig") { out[k] = v; continue; }
      throw new HttpError(400, "unknown_setting", `${path ? path + "." : ""}${k}`);
    }
    const isObj = shape[k] && typeof shape[k] === "object" && !Array.isArray(shape[k]);
    out[k] = isObj && v && typeof v === "object" && !Array.isArray(v) ? cleanSettings(v, shape[k], path ? `${path}.${k}` : k) : v;
  }
  return out;
}

router.post("/policies", requirePerm("policies.edit"), wrap(async (req, res) => {
  const company = await Company.findOne().sort({ createdAt: 1 });
  if (!req.body.name) throw new HttpError(400, "name_required");
  const p = await Policy.create({
    companyId: req.admin.companyId || company._id,
    name: req.body.name,
    description: req.body.description,
    settings: cleanSettings(req.body.settings),
  });
  await audit(req, "policy.created", { targetType: "policy", targetId: p._id, details: { name: p.name, settings: p.settings } });
  res.status(201).json({ policy: p });
}));

router.put("/policies/:id", requirePerm("policies.edit"), wrap(async (req, res) => {
  const p = await Policy.findById(req.params.id);
  if (!p) throw new HttpError(404, "not_found");
  const before = { name: p.name, settings: p.settings, version: p.version };
  if (req.body.name) p.name = req.body.name;
  if (req.body.description !== undefined) p.description = req.body.description;
  if (req.body.settings) {
    p.settings = cleanSettings(req.body.settings);
    p.markModified("settings");
  }
  p.version += 1;
  await p.save();
  let woke = 0;
  for (const a of await PolicyAssignment.find({ policyId: p._id }).lean()) woke += await wakeScope(a.scope, a.targetId);
  await audit(req, "policy.updated", { targetType: "policy", targetId: p._id, details: { before, after: { settings: p.settings, version: p.version }, devicesNotified: woke } });
  res.json({ policy: p, devicesNotified: woke });
}));

router.delete("/policies/:id", requirePerm("policies.edit"), wrap(async (req, res) => {
  const p = await Policy.findById(req.params.id);
  if (!p) throw new HttpError(404, "not_found");
  const assignments = await PolicyAssignment.find({ policyId: p._id }).lean();
  await PolicyAssignment.deleteMany({ policyId: p._id });
  await p.deleteOne();
  for (const a of assignments) await wakeScope(a.scope, a.targetId);
  await audit(req, "policy.deleted", { targetType: "policy", targetId: p._id, details: { name: p.name } });
  res.json({ ok: true });
}));

/** Assigns (or with policyId=null, clears) the policy for one level. */
router.put("/policy-assignments", requirePerm("policies.edit"), wrap(async (req, res) => {
  const { scope, targetId, policyId } = req.body;
  if (!["company", "store", "group", "device"].includes(scope) || !targetId) throw new HttpError(400, "scope_and_target_required");
  if (policyId) {
    if (!(await Policy.exists({ _id: policyId }))) throw new HttpError(400, "bad_policy");
    await PolicyAssignment.updateOne({ scope, targetId }, { $set: { policyId } }, { upsert: true });
  } else {
    await PolicyAssignment.deleteOne({ scope, targetId });
  }
  const woke = await wakeScope(scope, targetId);
  await audit(req, policyId ? "policy.assigned" : "policy.unassigned", { targetType: scope, targetId, details: { policyId, devicesNotified: woke } });
  res.json({ ok: true, devicesNotified: woke });
}));

module.exports = { router };
