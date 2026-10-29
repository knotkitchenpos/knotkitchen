/**
 * Dependency-free APK inspection: reads AndroidManifest.xml (binary XML) for
 * the package and version, and the APK Signature Scheme v2/v3 block for the
 * signing certificate. verifySignature() checks the signer's signature over
 * its signed data and the whole-file content digest, as `apksigner verify`.
 */
const crypto = require("crypto");
const zlib = require("zlib");

// ---------------- ZIP ----------------

function findEocd(buf) {
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error("not a zip file (no end of central directory)");
}

function readZip(buf) {
  const eocd = findEocd(buf);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  let p = cdOffset;
  while (p < cdOffset + cdSize) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.set(name, { method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, eocd, cdOffset, cdSize };
}

function readEntry(buf, entry) {
  const p = entry.localOffset;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error("bad local header");
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const data = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`unsupported zip method ${entry.method}`);
}

// ---------------- Binary XML (AndroidManifest.xml) ----------------

const ATTR_IDS = {
  0x0101021b: "versionCode",
  0x0101021c: "versionName",
  0x0101020c: "minSdkVersion",
  0x01010270: "targetSdkVersion",
};

function parseStringPool(buf, off) {
  const count = buf.readUInt32LE(off + 8);
  const flags = buf.readUInt32LE(off + 16);
  const stringsStart = buf.readUInt32LE(off + 20);
  const utf8 = (flags & 0x100) !== 0;
  const strings = [];
  for (let i = 0; i < count; i++) {
    let p = off + stringsStart + buf.readUInt32LE(off + 28 + i * 4);
    if (utf8) {
      let n = buf[p++];
      if (n & 0x80) p++; // char count, 2 bytes
      n = buf[p++];
      if (n & 0x80) n = ((n & 0x7f) << 8) | buf[p++];
      strings.push(buf.toString("utf8", p, p + n));
    } else {
      let n = buf.readUInt16LE(p); p += 2;
      if (n & 0x8000) { n = ((n & 0x7fff) << 16) | buf.readUInt16LE(p); p += 2; }
      strings.push(buf.toString("utf16le", p, p + n * 2));
    }
  }
  return strings;
}

function parseManifest(xml) {
  let strings = [];
  let resIds = [];
  const out = {};
  let p = 8; // after the XML file header
  while (p < xml.length) {
    const type = xml.readUInt16LE(p);
    const size = xml.readUInt32LE(p + 4);
    if (type === 0x0001) strings = parseStringPool(xml, p);
    else if (type === 0x0180) {
      const n = (size - 8) / 4;
      resIds = Array.from({ length: n }, (_, i) => xml.readUInt32LE(p + 8 + i * 4));
    } else if (type === 0x0102) {
      const ext = p + 16;
      const tag = strings[xml.readUInt32LE(ext + 4)];
      const attrStart = xml.readUInt16LE(ext + 8);
      const attrSize = xml.readUInt16LE(ext + 10);
      const attrCount = xml.readUInt16LE(ext + 12);
      const attrs = {};
      for (let i = 0; i < attrCount; i++) {
        const a = ext + attrStart + i * attrSize;
        const nameIdx = xml.readUInt32LE(a + 4);
        const name = ATTR_IDS[resIds[nameIdx]] || strings[nameIdx];
        const raw = xml.readInt32LE(a + 8);
        const dataType = xml[a + 15];
        const data = xml.readUInt32LE(a + 16);
        attrs[name] = dataType === 0x03 ? strings[raw >= 0 ? raw : data] : raw >= 0 ? strings[raw] : data;
      }
      if (tag === "manifest") {
        out.packageName = attrs.package;
        out.versionCode = Number(attrs.versionCode);
        out.versionName = attrs.versionName != null ? String(attrs.versionName) : undefined;
      } else if (tag === "uses-sdk") {
        if (attrs.minSdkVersion != null) out.minSdk = Number(attrs.minSdkVersion);
        if (attrs.targetSdkVersion != null) out.targetSdk = Number(attrs.targetSdkVersion);
      }
    }
    if (!size) break;
    p += size;
  }
  return out;
}

// ---------------- APK Signature Scheme v2 / v3 ----------------

const SIG_V2 = 0x7109871a;
const SIG_V3 = 0xf05368c0;

function lp(buf, off) {
  // length-prefixed (uint32) slice
  const n = buf.readUInt32LE(off);
  return { value: buf.subarray(off + 4, off + 4 + n), next: off + 4 + n };
}

function lpSequence(buf) {
  const items = [];
  let p = 0;
  while (p < buf.length) {
    const { value, next } = lp(buf, p);
    items.push(value);
    p = next;
  }
  return items;
}

function findSigningBlock(buf, cdOffset) {
  if (cdOffset < 32) return null;
  const magic = buf.toString("latin1", cdOffset - 16, cdOffset);
  if (magic !== "APK Sig Block 42") return null;
  const size = Number(buf.readBigUInt64LE(cdOffset - 24));
  const start = cdOffset - size - 8;
  const pairs = new Map();
  let p = start + 8;
  while (p < cdOffset - 24) {
    const len = Number(buf.readBigUInt64LE(p));
    const id = buf.readUInt32LE(p + 8);
    pairs.set(id, buf.subarray(p + 12, p + 8 + len));
    p += 8 + len;
  }
  return { start, pairs };
}

function parseSigner(signerBuf) {
  const signedData = lp(signerBuf, 0);
  // v3 has min/max SDK between signed data and signatures.
  const rest = signerBuf.subarray(signedData.next);
  const sd = signedData.value;
  const digests = lp(sd, 0);
  const certs = lp(sd, digests.next);
  const certificates = lpSequence(certs.value);
  const digestList = lpSequence(digests.value).map((d) => ({ algo: d.readUInt32LE(0), digest: lp(d, 4).value }));
  return { signedData: sd, certificates, digestList, rest };
}

function readSignatures(rest, isV3) {
  let off = isV3 ? 8 : 0;
  const sigs = lp(rest, off);
  const pub = lp(rest, sigs.next);
  const signatures = lpSequence(sigs.value).map((s) => ({ algo: s.readUInt32LE(0), sig: lp(s, 4).value }));
  return { signatures, publicKey: pub.value };
}

const ALGOS = {
  0x0101: { hash: "sha256", kind: "rsa-pss" },
  0x0102: { hash: "sha512", kind: "rsa-pss" },
  0x0103: { hash: "sha256", kind: "rsa" },
  0x0104: { hash: "sha512", kind: "rsa" },
  0x0201: { hash: "sha256", kind: "ec" },
  0x0202: { hash: "sha512", kind: "ec" },
  0x0301: { hash: "sha256", kind: "dsa" },
};

function signingInfo(buf, zip) {
  const block = findSigningBlock(buf, zip.cdOffset);
  if (!block) return null;
  const scheme = block.pairs.has(SIG_V3) ? "v3" : block.pairs.has(SIG_V2) ? "v2" : null;
  if (!scheme) return null;
  const value = block.pairs.get(scheme === "v3" ? SIG_V3 : SIG_V2);
  const signers = lpSequence(lp(value, 0).value);
  const signer = parseSigner(signers[0]);
  const { signatures, publicKey } = readSignatures(signer.rest, scheme === "v3");
  return { scheme, block, signer, signatures, publicKey };
}

/** Whole-file chunked content digest (APK Signature Scheme v2 §"integrity"). */
function contentDigest(buf, zip, blockStart, hash) {
  const eocd = Buffer.from(buf.subarray(zip.eocd));
  eocd.writeUInt32LE(blockStart, 16); // cd offset points at the signing block
  const sections = [buf.subarray(0, blockStart), buf.subarray(zip.cdOffset, zip.cdOffset + zip.cdSize), eocd];
  const chunkDigests = [];
  for (const s of sections) {
    for (let i = 0; i < s.length; i += 1 << 20) {
      const chunk = s.subarray(i, Math.min(i + (1 << 20), s.length));
      const head = Buffer.alloc(5);
      head[0] = 0xa5;
      head.writeUInt32LE(chunk.length, 1);
      chunkDigests.push(crypto.createHash(hash).update(head).update(chunk).digest());
    }
  }
  const top = Buffer.alloc(5);
  top[0] = 0x5a;
  top.writeUInt32LE(chunkDigests.length, 1);
  return crypto.createHash(hash).update(top).update(Buffer.concat(chunkDigests)).digest();
}

function verifySignature(buf, zip, info) {
  const key = crypto.createPublicKey({ key: info.publicKey, format: "der", type: "spki" });
  const cert = new crypto.X509Certificate(info.signer.certificates[0]);
  if (!cert.publicKey.export({ format: "der", type: "spki" }).equals(info.publicKey)) {
    throw new Error("signer public key does not match its certificate");
  }
  const s = info.signatures.find((x) => ALGOS[x.algo]);
  if (!s) throw new Error("no supported signature algorithm");
  const algo = ALGOS[s.algo];
  const verifyOpts = algo.kind === "rsa-pss"
    ? { key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: algo.hash === "sha256" ? 32 : 64 }
    : algo.kind === "ec" ? { key, dsaEncoding: "der" } : key;
  if (!crypto.verify(algo.hash, info.signer.signedData, verifyOpts, s.sig)) {
    throw new Error("APK signature does not verify");
  }
  const want = info.signer.digestList.find((d) => d.algo === s.algo);
  const got = contentDigest(buf, zip, info.block.start, algo.hash);
  if (!want || !want.digest.equals(got)) throw new Error("APK contents do not match the signed digest");
  return true;
}

/**
 * Inspects an APK buffer. Throws when it is not a valid, v2/v3-signed APK.
 */
function inspectApk(buf) {
  const zip = readZip(buf);
  const manifestEntry = zip.entries.get("AndroidManifest.xml");
  if (!manifestEntry) throw new Error("AndroidManifest.xml missing");
  const manifest = parseManifest(readEntry(buf, manifestEntry));
  if (!manifest.packageName || !Number.isFinite(manifest.versionCode)) throw new Error("could not read package/version");
  const info = signingInfo(buf, zip);
  if (!info) throw new Error("APK is not signed with APK Signature Scheme v2/v3");
  verifySignature(buf, zip, info);
  const certDer = info.signer.certificates[0];
  const certSha256 = crypto.createHash("sha256").update(certDer).digest();
  return {
    ...manifest,
    sha256: crypto.createHash("sha256").update(buf).digest("hex"),
    size: buf.length,
    signatureScheme: info.scheme,
    signingCertSha256: certSha256.toString("hex"),
    // Format PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM expects.
    signatureChecksum: certSha256.toString("base64url"),
    packageChecksum: crypto.createHash("sha256").update(buf).digest("base64url"),
  };
}

module.exports = { inspectApk, parseManifest, readZip, readEntry };
