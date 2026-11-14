# Integrity as assertions — proposed revision of §14

Status: **proposal for team review.** Does not replace `PLAN-integrity.md` (owner: Kophshi); it
re-centres it on asserted conditions. Nothing here changes `PLAN.md` until the team agrees.

**One line for the deck:** *We assert the conditions the route depends on, against the source
data, and sign the files we ship.*

---

## 1. Principle and honest limits

An assertion states a condition, names the input it reads, names an **independent reference** to
compare against, and says what happens on failure. An assertion that only reads the planner's own
output proves the planner agrees with itself, so every route assertion below recomputes from the DEM
or `params.json`, never from numbers the planner wrote.

What this does **not** do (say so on the slide):

- It cannot show the data matches the real surface of Mars. It checks our files against the source
  DEM and against an independent calculation.
- It cannot verify NASA's live Trek tiles; NASA publishes no hashes for them.
- Every limit and tolerance is `ASSUMED` until sourced; passing means "within our stated limits".
- Slope at the analysis cell size understates local steepness (see D10).

## 2. What changes against PLAN-integrity.md

| Item | Verdict | Why |
|---|---|---|
| Signed hash list (BLAKE3 + Ed25519), pinned key | **Keep, simplified** | Ties each check to the exact bytes we ship. |
| Merkle tree over five files | **Drop** | The doc itself says it is more structure than needed. Sign a flat list of hashes. |
| Tamper demo button | **Keep** | Most visible part of the feature. |
| Z3 on route constraints (C1–C5) | **Replace with R1–R10** | Fixed-number checks need no solver. Run them in the build script. |
| Z3 | **Keep as optional, for S1–S3 only** | Symbolic properties over the rule model are what a solver does that a loop cannot. |
| Python `verify_route.py` plus TS `check.ts` that must agree (T7) | **One implementation** | Two copies of the same checks doubles the work and adds a disagreement to debug. |
| Refuse the route on any hash mismatch | **Warn-only until the freeze** | See §5. A late edit without re-signing must not kill the demo. |

## 3. Assertions

Failure action: **BUILD** = the build script exits non-zero. **REFUSE** = the planner refuses and
names the assertion. **WARN** = badge goes amber, app keeps working.

### D — data (run at build time on the committed rasters and the DEM corridor)

| ID | Assertion | Checked against | On fail |
|---|---|---|---|
| D1 | `slope.png`, `los.png` and the DEM corridor share width, height and bounds | The corridor file | BUILD |
| D2 | Corridor bounds lie inside the Gale 25 cm mosaic extent (137.12–137.73°E, 4.93–4.25°S per Trek capabilities) | Trek WMTS capabilities | BUILD |
| D3 | No NaN or no-data cell inside the corridor, or each such cell is masked | The DEM | BUILD |
| D4 | Slope values lie in 0°–90° | The raster | BUILD |
| D5 | DEM elevations agree with MOLA samples within a tolerance (catches wrong units, offsets, registration) | MOLA 463 m tiles or grid at ≥ 20 points | BUILD |
| D6 | Slope recomputed with a **different algorithm** matches `slope.png`: max and mean difference within tolerance | The DEM | BUILD |
| D7 | Every cell steeper than the suit limit is in the hard mask; no cell is masked without a reason (slope, no-data or crew report) | `params.json`, DEM | BUILD |
| D8 | LOS raster: the relay cell is visible; all blackout values ≥ 0 | The DEM | BUILD |
| D9 | Registration: measured offset of a known landmark between Trek imagery and the DEM is within tolerance (spike 4; the measured value is recorded) | Landmark | WARN |
| D10 | Record native cell size, analysis cell size, and the measured gap between max slope at native resolution and at analysis resolution; the UI shows it | The DEM | INFO |

### R — route (run at build time on the committed demo route, and live in the app on any new route)

| ID | Assertion | Checked against | On fail |
|---|---|---|---|
| R1 | Route starts at the declared haven and ends at the target | `params.json` | REFUSE |
| R2 | Consecutive steps are adjacent cells; all steps lie inside the corridor | The grid | REFUSE |
| R3 | Per-step slope, **recomputed from the DEM**, is at most the suit limit | DEM, `params.json` | REFUSE |
| R4 | No step is in a masked cell, including crew Avoid reports | Mask, reports | REFUSE |
| R5 | ETA equals the sum of step costs, within tolerance | Cost function | REFUSE |
| R6 | O₂, water and battery are non-increasing along the route | The timeline | REFUSE |
| R7 | Each crew member's reserve at return is at least `reserve_min` (20%) | `params.json` | REFUSE |
| R8 | Walk-back margin is non-negative at every step | The time-to-safety raster | REFUSE |
| R9 | The limits the route used equal `params.json` (hash match) | `params.json` | REFUSE |
| R10 | Straight-line baseline was computed and is stored | The route | WARN |

### P — parameters

| ID | Assertion | On fail |
|---|---|---|
| P1 | `reserve_min` is 20 | BUILD |
| P2 | Every parameter is present, inside its declared range, and marked `ASSUMED` or `CITED` | BUILD |
| P3 | `params.json` and `docs/assumptions.md` agree (generate one from the other) | BUILD |

### S — symbolic properties (optional, Z3, cut first if time is short)

These prove properties of the **rule model**, not the code.

| ID | Property |
|---|---|
| S1 | For all slopes above the limit, the model marks the cell impassable |
| S2 | No value of the risk-tolerance slider makes a masked cell passable |
| S3 | Consumable use is non-negative at every step for any non-negative metabolic rate |

## 4. Output and UI

- `scripts/assert_data.ts` (build) and `src/integrity/assertions.ts` (live) share the R-series code,
  so there is one implementation. The independent slope reference in D6 is a separate function using
  a different algorithm, written by a different person if possible.
- Output `public/integrity/assertions.json`: for each ID the status, the measured value, the
  tolerance and the BLAKE3 of the file it checked (including the source DEM).
- UI: a badge reading "N of N assertions passed", with the failing ones listed and clickable. Chips
  on each layer show verified / mismatch / not checked.
- Tamper demo: flips one byte in an in-memory copy of `slope.png`. The matching assertions fail, the
  badge turns red and the planner refuses.

## 5. Failure policy that cannot kill the demo

- A hash mismatch is **warn-only until the freeze** (Sunday 15:00). After the freeze, flip the flag.
- Mark `public/**` as binary in `.gitattributes`. Windows line-ending conversion would otherwise
  change JSON and GeoJSON bytes and make every text file mismatch on the deployed copy.
- Sign during the build from the exact bytes in `public/`, not by hand.
- Any teammate editing `params.json`, `route.json` or a raster must re-run the build step. Add a
  pre-push hook or CI step that fails if the manifest is stale.
- Final step before each submission: open the **deployed** URL cold and check the badge.
- A network failure shows "not checked" and never refuses a route.

## 6. Schedule (about 2.5 h)

| Step | Time |
|---|---|
| D1–D4, D7, D8 plus synthetic test grids with known slope (plane, step, flat) | 45 min |
| D6 independent slope and D5 MOLA cross-check, tolerances calibrated on real data | 45 min |
| R1–R10 and the badge, using a fixture `route.json` | 30 min |
| Signed hash list, chips, tamper demo | 30 min |

Cut order: S1–S3, D9, D10 display, then tiled `slope.png`. Keep D3–D7 and R3 last; they are the
ones that catch a wrong slope raster.

Placement: after P1 #12, not before #9–#12. The integrity gate is **off by default**, so no P0 test
depends on it.

## 7. `route.json` fields needed before the schema freezes

Per `timeline[]` step: `slope_deg`, `masked`, and the cell index (needed for R2). At top level:
`params_blake3`.

## 8. Open questions

1. Spike 2 decides the DEM source. If `exportImage` returns only 8-bit imagery, D5 and D6 change.
2. Tolerances for D5, D6 and R5 are unknown until the first real run. Calibrate on synthetic grids
   first, then on the real corridor, and record the numbers in `docs/assumptions.md`.
3. Is there a second person available to write the D6 reference?

## 9. Honest text for the slide

"Checked against the source elevation data and an independent calculation, within limits we chose.
Not checked against the surface of Mars. Live NASA tiles are not covered."
