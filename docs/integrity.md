# Data integrity — what is implemented

Design of record: `docs/integrity-assertions.md` (flat signed hash list; no Merkle tree; no Z3 in the demo).

## Pieces

| File | Role |
|---|---|
| `web/integrity.js` | Canonical manifest, BLAKE3 (`@noble/hashes` 1.8.0, vendored in `web/vendor/noble-hashes`), Ed25519 verify (WebCrypto), path allowlist, `verifyAll`, `tamperedCopy`. Same code in Node and the browser. |
| `web/integrity-pubkey.js` | Pinned public key + key id. |
| `web/public/integrity/manifest.json` + `.sig` | Signed list of every file under `web/public/data/**` (`.json`/`.geojson`): path, size, BLAKE3 of the raw bytes. |
| `web/integrity-ui.js` | Verify-on-load chip in the Path tab, **Tamper test** button, `signedBytes(path)`. |
| `scripts/sign-manifest.mjs` | `--keygen`, sign (also regenerates `public/data/params.json` from `survival.js`), `--verify` (also lists unsigned files). |
| `web/test/integrity.test.mjs` | valid, one-bit flip, wrong key, missing file, edited manifest, path outside allowlist, malformed/non-canonical manifest, unlisted file, params.json = code. |

## Behaviour

- Page load: fetch manifest + signature → verify Ed25519 over the exact manifest bytes with the pinned key →
  hash every listed file → chip **✓ Data verified n/n** or **✗ Integrity mismatch <file>**.
- *Load demo excursion* uses only bytes that match the manifest; otherwise the route is **REFUSED — integrity: …**.
- *Tamper test* flips one bit of `route.json` **in memory** and re-verifies: the chip names the file and the
  demo route is refused. *Reset* re-verifies the real files.
- Routes computed live in the browser are labelled "a live check, not signed".

## Threat model (say exactly this)

Detects modified or corrupted data files relative to an offline-signed manifest. Assumes the app code is
trusted. Does not protect against a compromised server (it could serve different code and key), does not
verify NASA's live Trek tiles, and says nothing about whether the data matches the real surface of Mars.

## Key handling

- Private key: `~/.config/happyfeet/manifest-ed25519.pem` on yasser's laptop, mode 0600, never committed.
  Back it up offline. Lose it → run `--keygen --force`, re-sign, commit the new `integrity-pubkey.js`.
- **Anyone who changes a file under `web/public/data/` must get it re-signed** (`node scripts/sign-manifest.mjs`
  by the key holder) — until then the chip is red and `npm test` fails on "committed manifest verifies".
  That is the point: unsigned data changes are visible.
