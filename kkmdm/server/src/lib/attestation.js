/**
 * Android key attestation check at enrollment. The agent creates a key in the
 * hardware keystore with attestation challenge = SHA-256(enrollment token)
 * and sends the certificate chain. We check:
 *   1. every certificate is signed by the next one;
 *   2. the leaf carries the key-attestation extension containing our challenge;
 *   3. the root is a Google attestation root (ATTESTATION_ROOT_SHA256, comma
 *      separated SHA-256 fingerprints of the roots Google publishes).
 * Without (3) configured a valid chain is reported as "chain_ok_root_unpinned".
 * Play Integrity is the GMS-device alternative; see docs §4.
 */
const crypto = require("crypto");

// 1.3.6.1.4.1.11129.2.1.17 DER-encoded
const ATTEST_OID = Buffer.from("060a2b06010401d679020111", "hex");

function verifyAttestation(att, tokenHashHex) {
  if (!att?.chain?.length) return { verified: false, detail: "none" };
  try {
    const certs = att.chain.map((b64) => new crypto.X509Certificate(Buffer.from(b64, "base64")));
    for (let i = 0; i < certs.length - 1; i++) {
      if (!certs[i].verify(certs[i + 1].publicKey)) return { verified: false, detail: `chain_broken_at_${i}` };
    }
    const leaf = certs[0].raw;
    const at = leaf.indexOf(ATTEST_OID);
    if (at < 0) return { verified: false, detail: "no_attestation_extension" };
    if (leaf.indexOf(Buffer.from(tokenHashHex, "hex"), at) < 0) return { verified: false, detail: "challenge_mismatch" };
    const root = certs[certs.length - 1];
    const fp = crypto.createHash("sha256").update(root.raw).digest("hex");
    const pinned = (process.env.ATTESTATION_ROOT_SHA256 || "").toLowerCase().split(",").map((s) => s.replace(/:/g, "").trim()).filter(Boolean);
    if (!pinned.length) return { verified: false, detail: "chain_ok_root_unpinned", rootSha256: fp };
    if (!pinned.includes(fp)) return { verified: false, detail: "unknown_root", rootSha256: fp };
    return { verified: true, detail: "hardware_attested" };
  } catch (err) {
    return { verified: false, detail: `parse_error:${err.message.slice(0, 60)}` };
  }
}

module.exports = { verifyAttestation };
