/**
 * The agent APK the setup wizard downloads during QR provisioning, and the
 * checksum that goes into the QR. Source, in order: AGENT_APK_URL (+ its
 * AGENT_SIGNATURE_CHECKSUM), else storage/agent/kk-agent.apk served by us.
 */
const fs = require("fs");
const path = require("path");
const config = require("../config");
const { inspectApk } = require("./apk");

const AGENT_FILE = path.join(config.storageDir, "agent", "kk-agent.apk");
let cache = null; // { mtimeMs, info }

function localAgentInfo() {
  if (!fs.existsSync(AGENT_FILE)) return null;
  const { mtimeMs } = fs.statSync(AGENT_FILE);
  if (!cache || cache.mtimeMs !== mtimeMs) {
    cache = { mtimeMs, info: inspectApk(fs.readFileSync(AGENT_FILE)) };
  }
  return cache.info;
}

function agentDownload() {
  if (config.agentApkUrl) {
    return { url: config.agentApkUrl, signatureChecksum: config.agentSignatureChecksum, source: "env" };
  }
  const info = localAgentInfo();
  if (!info) return null;
  return {
    url: `${config.publicUrl}/agent/kk-agent.apk`,
    signatureChecksum: config.agentSignatureChecksum || info.signatureChecksum,
    packageChecksum: info.packageChecksum,
    versionCode: info.versionCode,
    versionName: info.versionName,
    source: "local",
  };
}

module.exports = { AGENT_FILE, agentDownload, localAgentInfo };
