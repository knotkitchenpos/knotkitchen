const { Device, DeviceCredential } = require("../models");
const { sha256, randomToken } = require("./crypto");

/**
 * Devices authenticate with "Authorization: Device <deviceId>.<secret>".
 * The secret is 256 random bits issued at enrollment; only its SHA-256 is
 * stored. Rotation issues a new one and revokes the old after first use.
 */
async function authenticateDeviceHeader(header) {
  const m = /^Device ([a-f0-9]{24})\.([A-Za-z0-9_-]{40,})$/.exec(header || "");
  if (!m) return null;
  const [, deviceId, secret] = m;
  const cred = await DeviceCredential.findOne({ secretHash: sha256(secret), deviceId, revokedAt: null });
  if (!cred) return null;
  const device = await Device.findById(deviceId);
  if (!device || device.lifecycle === "retired") return null;
  // Using a rotated-in credential retires the ones before it.
  if (!cred.lastUsedAt) {
    await DeviceCredential.updateMany(
      { deviceId, _id: { $ne: cred._id }, revokedAt: null, createdAt: { $lt: cred.createdAt } },
      { $set: { revokedAt: new Date(), revokedReason: "rotated" } },
    );
  }
  cred.lastUsedAt = new Date();
  await cred.save();
  return { device, credential: cred };
}

async function issueCredential(deviceId) {
  const secret = randomToken(32);
  await DeviceCredential.create({ deviceId, secretHash: sha256(secret) });
  return `${deviceId}.${secret}`;
}

async function revokeAll(deviceId, reason) {
  await DeviceCredential.updateMany({ deviceId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
}

function requireDevice() {
  return async (req, res, next) => {
    try {
      const auth = await authenticateDeviceHeader(req.headers.authorization);
      if (!auth) return res.status(401).json({ error: "device_unauthorized" });
      req.device = auth.device;
      req.credential = auth.credential;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { authenticateDeviceHeader, issueCredential, revokeAll, requireDevice };
