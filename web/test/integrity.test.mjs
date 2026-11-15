import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateKeyPairSync, sign } from "node:crypto";
import { verifyAll, verifyManifest, checkFile, tamperedCopy, canonicalManifest, parseManifest, blake3Hex, keyId, b64 } from "../integrity.js";
import { MANIFEST_PUBLIC_KEY, MANIFEST_KEY_ID } from "../integrity-pubkey.js";
import { SURVIVAL_PARAMS } from "../survival.js";

const W = new URL("../", import.meta.url);
const read = (p) => readFile(new URL(p, W));
const manifestText = await readFile(new URL("public/integrity/manifest.json", W), "utf8");
const signatureB64 = await readFile(new URL("public/integrity/manifest.sig", W), "utf8");
const base = { manifestText, signatureB64, publicKeyB64: MANIFEST_PUBLIC_KEY, readFile: read };

test("BLAKE3 matches the official test vector", () => {
  assert.equal(blake3Hex(new TextEncoder().encode("abc")), "6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85");
});

test("committed manifest verifies and every shipped data file matches", async () => {
  const r = await verifyAll(base);
  assert.equal(r.ok, true, r.error?.message);
  assert.ok(r.files.some((f) => f.path === "public/data/route.json"));
  assert.ok(r.files.some((f) => f.path === "public/data/params.json"));
  assert.equal(r.manifest.key_id, MANIFEST_KEY_ID);
});

test("a one-bit flip in route.json is detected and names the file", async () => {
  const bytes = await read("public/data/route.json");
  const r = await verifyAll({ ...base, override: { "public/data/route.json": tamperedCopy(bytes) } });
  assert.equal(r.ok, false);
  assert.equal(r.error.path, "public/data/route.json");
  assert.equal(r.files.find((f) => f.path === "public/data/route.json").status, "mismatch");
  // the original buffer was not modified
  assert.equal(blake3Hex(bytes), r.manifest.files.find((f) => f.path === "public/data/route.json").blake3);
});

test("a wrong public key fails", async () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  const other = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url").toString("base64");
  const r = await verifyAll({ ...base, publicKeyB64: other });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "signature");
});

test("a missing file fails", async () => {
  const r = await verifyAll({ ...base, readFile: async (p) => (p.endsWith("params.json") ? null : read(p)) });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "missing");
  assert.equal(r.error.path, "public/data/params.json");
});

test("an edited manifest (hash swapped) fails the signature", async () => {
  const edited = manifestText.replace(/"blake3":"[0-9a-f]/, (m) => m.slice(0, -1) + (m.at(-1) === "0" ? "1" : "0"));
  const r = await verifyAll({ ...base, manifestText: edited });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "signature");
});

test("a correctly signed manifest with a path outside the allowlist is rejected", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  for (const bad of ["../serve.mjs", "public/data/../../serve.mjs", "https://evil.example/x.json", "index.html"]) {
    const text = canonicalManifest({ created: "t", key_id: keyId(raw), files: [{ path: bad, size: 1, blake3: "0".repeat(64) }] });
    const sig = b64(sign(null, Buffer.from(text), privateKey));
    await assert.rejects(verifyManifest(text, sig, raw.toString("base64")), (e) => e.code === "path");
  }
});

test("malformed manifests are rejected", () => {
  assert.throws(() => parseManifest("{nope"), (e) => e.code === "malformed");
  assert.throws(() => parseManifest(JSON.stringify({ schema: "x", files: [] })), (e) => e.code === "malformed");
  assert.throws(() => parseManifest(manifestText.replace("\n]}", "]}")), (e) => e.code === "malformed"); // not canonical
});

test("a file not listed in the manifest is refused", async () => {
  const m = parseManifest(manifestText);
  assert.throws(() => checkFile(m, "public/data/extra.json", new Uint8Array([1])), (e) => e.code === "unlisted");
});

test("signed params.json equals the coefficients the page uses (assertion P1/P3)", async () => {
  const p = JSON.parse(await read("public/data/params.json"));
  assert.deepEqual(p.params, { ...SURVIVAL_PARAMS });
  assert.equal(p.params.reserve_frac, 0.2);
});
