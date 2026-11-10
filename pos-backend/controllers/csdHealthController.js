const createHttpError = require("http-errors");
const Store = require("../models/storeModel");
const { computeHealth } = require("../services/storeHealth");
const alerts = require("../services/storeAlerts");
const { hasSection } = require("../constants/csdSections");

const BILLING_KINDS = new Set(["wallet_low", "subscription_ending"]);

/** Plan and wallet facts, removed for someone limited away from Billing. */
const withoutBilling = (health) => {
  const rows = health.rows
    .map(({ balancePaise, plan, ...r }) => {
      const issues = r.issues.filter((i) => !BILLING_KINDS.has(i.kind));
      return { ...r, issues, critical: issues.filter((i) => i.severity === "critical").length };
    })
    .filter((r) => r.issues.length);
  return { ...health, rows, counts: { ...health.counts, wallet_low: 0, subscription_ending: 0 } };
};

/** GET /api/csd/health — stores at risk, with which alerts can be sent. */
const getHealth = async (req, res, next) => {
  try {
    const [full, templates, settings] = await Promise.all([computeHealth(), alerts.templateStatus(), alerts.getSettings()]);
    const health = hasSection(req.csdStaff, "billing") ? full : withoutBilling(full);
    const sent = await alerts.lastSent(health.rows.map((r) => r.storeId));
    res.status(200).json({
      success: true,
      data: {
        ...health,
        rows: health.rows.map((r) => ({ ...r, lastAlerts: sent[r.storeId] || {} })),
        alerts: {
          autoEnabled: !!settings.autoEnabled,
          cooldownDays: alerts.COOLDOWN_DAYS,
          kinds: Object.fromEntries(Object.entries(templates.kinds).map(([k, v]) => [k, { label: v.label, template: v.template, wording: v.wording, ready: v.ready }])),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/csd/health/stores/:storeId/alerts { kind } — alert this store's owner now. */
const sendStoreAlert = async (req, res, next) => {
  try {
    const storeId = String(req.params.storeId || "");
    const kind = String(req.body?.kind || "");
    if (!/^\d{6}$/.test(storeId)) return next(createHttpError(400, "Invalid store."));
    if (!alerts.KINDS[kind]) return next(createHttpError(400, "That problem has no customer alert."));
    if (BILLING_KINDS.has(kind) && !hasSection(req.csdStaff, "billing")) return next(createHttpError(403, "You do not have access to this section."));
    const exists = await Store.exists({ storeId, isDeleted: { $ne: true } });
    if (!exists) return next(createHttpError(404, "Store not found."));

    // Re-derived from live data: an alert can only say what is true right now.
    const { rows } = await computeHealth();
    const store = rows.find((r) => r.storeId === storeId);
    const issue = store?.issues.find((i) => i.kind === kind);
    if (!issue) return next(createHttpError(409, "This store no longer has that problem."));

    await alerts.sendAlert({ store, issue, actor: { id: req.csdStaff._id, name: req.csdStaff.fullName || req.csdStaff.staffId } });
    res.status(200).json({ success: true, data: { sent: true } });
  } catch (error) {
    if (error instanceof alerts.AlertError) {
      const e = createHttpError(error.status, error.message, { expose: true });
      return next(e);
    }
    if (error?.status && error?.code) return next(createHttpError(error.status, error.message, { expose: true }));
    next(error);
  }
};

/** PATCH /api/csd/health/alerts { autoEnabled } — admin only. */
const updateAlertSettings = async (req, res, next) => {
  try {
    if (typeof req.body?.autoEnabled !== "boolean") return next(createHttpError(400, "Say on or off."));
    const s = await alerts.setAuto(req.body.autoEnabled, req.csdStaff.fullName || req.csdStaff.staffId);
    res.status(200).json({ success: true, data: { autoEnabled: s.autoEnabled } });
  } catch (error) {
    next(error);
  }
};

module.exports = { getHealth, sendStoreAlert, updateAlertSettings };
