# PLAN-integrity — Data integrity and route verification

Extension to `PLAN.md` (adds §14 and a few small edits, listed in §15 below).
Owner: Kophshi. Status: **proposal, for team review**.

**One line for the deck:** *We verify the data the crew relies on, then check the route against the safety rules.*

---

## 0. PR summary

| | |
|---|---|
| **Adds** | A signed manifest for the files we ship (BLAKE3 + Ed25519) and an offline Z3 check of the demo route |
| **Why** | Safety is the brief's first priority. A wrong slope raster or a changed route is worse than no map, and comms delay means the crew can't ask Earth. Also lifts Creativity and Validity. |
| **Touches existing code** | Almost nothing. Two new modules with no Cesium imports, one build script, one Python script. Integration is only the provenance chip state and a badge. |
| **Needs from the team now** | Two extra fields in the `route.json` schema **before it is frozen** (§14.6) |
| **Cost** | ~3 h, can be built in parallel against a fixture `route.json` |

---

## 14. Integrity and verification

### 14.1 Principle and honest limits

**Trust the data, then check the route.** A route check is only as good as the data under it, so verification runs first.

What this does **not** do (say so on the slide):

- It cannot verify NASA's live Trek tiles. NASA publishes no hashes for them. We verify only files **we control**.
- The "Earth" signing key is **simulated** for the demo. We are showing the mechanism, not a real NASA key chain.
- Z3 proves the route meets **our** constraints (slope limit, reserve, walk-back). Those limits are `ASSUMED` parameters. It does not prove the route is safe on real Mars.

### 14.2 Files covered by the manifest

| File | Why it matters |
|---|---|
| `public/rasters/slope.png` | Router reads it. A changed value can hide a cliff. |
| `public/rasters/los.png` | Comms blackout term. |
| `public/route.json` | What the VR HUD and route card display. |
| `public/reports/demo.geojson` | Crew reports change the mask. |
| `public/params.json` | Safety limits (slope, reserve, walk-back). Kept **outside** `route.json` so a route cannot carry looser limits than the ones we signed. |

### 14.3 Manifest format

Hash: **BLAKE3**. Signature: **Ed25519** (BLAKE3 only hashes; it does not sign).

- Leaf = `BLAKE3("leaf\0" ‖ path ‖ "\0" ‖ BLAKE3(file bytes))`, files sorted by path.
- Node = `BLAKE3("node\0" ‖ left ‖ right)`. An unpaired node is promoted, never duplicated.
- Signed message = `"MARS-MANIFEST-v1\0" ‖ root(32 B) ‖ version(u32 BE) ‖ created_unix(u64 BE)`.

```json
{
  "version": 3,
  "created_utc": "2026-11-15T10:00:00Z",
  "files": [{ "path": "rasters/slope.png", "blake3": "..." }],
  "root": "...",
  "signature": "..."
}
```

Rules that make it meaningful:

- **The public key is pinned in the app source** (`src/integrity/pubkey.ts`) and shown on the slide. It is never read from the manifest, or an attacker could swap both.
- **The private key is never committed.** Add it to `.gitignore`. Sign locally, commit only `manifest.json`.
- **Rollback guard:** the app rejects `version < MIN_VERSION` (constant in code). Timestamps are shown but not trusted.
- A Merkle tree over five files is more structure than needed; its value is a single signed root. **Stretch:** tile `slope.png` so a tamper alarm points to the exact tile on the map.

### 14.4 Verify in the browser

Module `src/integrity/verify.ts` (pure TS, no Cesium imports, shared by the Cesium app and the VR scene).

1. Fetch `manifest.json`. Verify the Ed25519 signature with the pinned key.
2. Fetch each listed file, hash it, compare.
3. Return `{ ok, perFile: { path, state: verified | mismatch | missing }[] }`.
4. Provenance chips show a state: **verified** / **MISMATCH** / **not checked**.
5. **Gate:** `planRoute()` only receives rasters whose state is `verified`. A mismatch means the route is refused with the reason, in the same way as an infeasible route.
6. **Never block the demo on a network failure.** If the manifest cannot be fetched, show "integrity: not checked" and carry on. Only an actual mismatch refuses.

Libraries: `@noble/hashes` (has BLAKE3) and `@noble/curves` or `@noble/ed25519`. Pure JS, no WASM, so it should run in the Quest browser too (spike S-A).

**Tamper demo button** (the memorable demo moment): flips one byte in an **in-memory copy** of `slope.png`. The chip turns red, the planner refuses, the card says which file failed. It never touches the real file.

### 14.5 Route check (formal)

Script `scripts/verify_route.py` (`z3-solver`). Reads `public/route.json` and `public/params.json`. For each constraint it asserts the **negation** and asks Z3 for a counterexample: `unsat` means proven for this route, `sat` returns the failing step.

| ID | Constraint |
|---|---|
| C1 | every step `slope_deg ≤ slope_limit` |
| C2 | no step is `masked` (hard mask, including crew Avoid reports) |
| C3 | every crew member's reserve at return `≥ reserve_min` (20%) |
| C4 | every step `walkback_margin_s ≥ 0` |
| C5 | consumables never increase along the route (sanity check of the resource model) |

Output `public/integrity/route_cert.json`, covered by the manifest:

```json
{
  "route_blake3": "...", "params_blake3": "...",
  "z3_version": "...",
  "results": [{ "id": "C1", "status": "proved" }],
  "created_utc": "..."
}
```

**Badges (never mix these up):**

| Situation | Badge |
|---|---|
| Committed demo route, cert matches `route.json` hash | **Constraint check passed (Z3, offline, signed)** |
| Route edited in the app | **Live check passed (not a proof)** from a small TS re-check in `src/integrity/check.ts` |
| `route.json` hash differs from the cert | no formal badge |

The two implementations (Python and TS) must agree on the committed route (test T7).

### 14.6 `route.json` schema: needs two fields now

The schema is about to be frozen (§11). The verifier needs, per `timeline[]` step:

- `slope_deg` (number)
- `masked` (boolean)

`walkback_margin_s` and the O₂ / water / battery % fields are already in the plan.

### 14.7 Layout

```
src/integrity/verify.ts       # manifest + signature + hashes (no Cesium)
src/integrity/check.ts        # live TS route check
src/integrity/pubkey.ts       # pinned public key, MIN_VERSION
scripts/sign_manifest.ts      # build step, needs the private key
scripts/verify_route.py       # Z3, writes the certificate
public/params.json
public/manifest.json
public/integrity/route_cert.json
docs/integrity.md             # what is and is not verified (the honest slide text)
```

### 14.8 Acceptance tests

| # | Test |
|---|---|
| T1 | Cold load: signature valid, all five files `verified` |
| T2 | Tamper button: chip red, planner refuses, card names the file |
| T3 | Manifest missing: "not checked", app still works |
| T4 | Manifest signed with another key: rejected |
| T5 | `version < MIN_VERSION`: rejected |
| T6 | Edit one step of `route.json` to slope above the limit: Z3 returns `sat` and names the step |
| T7 | Python result and TS live check agree on the committed route |
| T8 | `route.json` changed after the cert was made: formal badge disappears |

### 14.9 Spikes

| # | Question | Time |
|---|---|---|
| S-A | Do `@noble` hashes and curves build under Vite and run in the Quest browser? | 15 min |
| S-B | Does the same file give the same BLAKE3 hash in Python and in JS? | 10 min |
| S-C | `pip install z3-solver` works on the build machine? | 5 min |

### 14.10 Priority and schedule

**P1 #8b**, directly after #8. Rule from §9 still applies: no P1 work starts until every P0 test passes. The modules can be built **in parallel** against a hand-written fixture `route.json`; only the chip state and the badge touch shared UI.

| Step | Time |
|---|---|
| `sign_manifest.ts` + `verify.ts` + chips + tamper button | 1.5 h |
| `verify_route.py` + certificate + badge | 1 h |
| `check.ts` live re-check + tests T1–T8 | 0.5–1 h |

**Cut order if time runs short:** (1) tiled `slope.png`, (2) live TS check, (3) certificate, keeping signed manifest + tamper demo, which is the most visible part.

### 14.11 Deck and References

- No eighth slide. Use two lines on the route-card slide: the badge and the tamper demo. Add the honest limits line from §14.1.
- References to add: BLAKE3 specification (O'Connor, Aumasson, Neves, Wilcox-O'Hearn); RFC 8032 (Ed25519); Z3 (de Moura and Bjørner, TACAS 2008); `@noble/hashes` and `@noble/curves`.
- AI-use declaration covers code assistance for these modules.

### 14.12 Out of scope

Zero-knowledge proofs · TLA+ model of the update protocol (one line of future work on a slide) · verifying live NASA tiles · a real key chain · rollback protection beyond `MIN_VERSION`.

---

## 15. Proposed edits to `PLAN.md`

1. **§3 table**, add row: `Integrity | BLAKE3 + Ed25519 manifest over committed files, offline Z3 route certificate | Verifies only what we control; see PLAN-integrity.md`.
2. **§3 cut list**, add: `verifying live Trek tiles (no published hashes)` · `ZK proofs` · `TLA+ model`.
3. **§7 spikes**, add S-A, S-B, S-C from §14.9.
4. **§8 definition of done**, add: `If P1 #8b shipped: manifest verifies on load, the tamper button turns a chip red and the planner refuses, and the committed route shows the signed Z3 badge.`
5. **§9 P1**, add: `8b | Integrity: signed manifest, tamper demo, Z3 route certificate | 3 h | PLAN-integrity.md. Test: T1–T8`.
6. **§10**, add `manifest.json`, `params.json` and `integrity/route_cert.json` to the committed files.
7. **§11 `route.json`**, add `timeline[].slope_deg` and `timeline[].masked`.
