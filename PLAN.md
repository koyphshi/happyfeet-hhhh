# PLAN — Interplanetary Survival Guide: Martian Map

Status: **decisions frozen**. This document records *what we are building and why*.
Implementation detail lives in code and in `RESEARCH-mars-cesium-feasibility.md`.

Deadline: **Sunday 15 Nov 2026, 23:59 local.** Submit a complete version by **17:00**, then improve and resubmit.
Only the last saved submission is judged.

---

## 1. Product

A single-page **mission-planning and Marswalk-survival view** of one hyperlocal site on Mars.

An astronaut (or the habitat console) picks a science target, sees the terrain layered with
NASA data, gets a route that respects suit mobility, terrain hazards and comms blackout,
and is told — before they step outside — whether the oxygen and battery budget actually
gets them home.

**Demo site:** Gale crater / Glen Torridon, boxwork formations (the science objective named
in the challenge brief). **Architecture is site-agnostic**; a tiered site registry lets other
locations load, labelled with their real data resolution.

---

## 2. Hard constraints (these are pass/fail, not preferences)

| Constraint | Consequence |
|---|---|
| Every project link must be public — no login, no registration, no setup | Static hosting only. No auth, ever. No local `cargo run`. |
| Demo is **either** ≤7 slides **or** ≤30 s video | 7-slide deck, exactly 7 including title. Over the limit = scored 1, not evaluated. |
| NASA data must be a *core* component, not decorative | Provenance chip on every layer: dataset, mission, resolution, date. |
| At least 3 kinds of data | We ship **5 measured** (optical, topographic, thermal, spectral, atmospheric) + 1 modelled (radiation). |
| All external resources listed in References | Every dataset, library, basemap, font, model, AI tool. |
| SI (AI) use must be declared; AI media watermarked | Declared honestly. No AI inference in the runtime. |

---

## 3. Settled architecture

| Decision | Choice | Why |
|---|---|---|
| Renderer | **CesiumJS 1.147**, `Cesium.Ellipsoid.MARS` (3396190 / 3376200) | Real IAU biaxial ellipsoid; official Mars Sandcastle demo to copy. |
| Framework | Vite + TypeScript | Static build, deployable in minutes. |
| Rust / Bevy | **Out of the demo path** | Bevy's geospatial crates are Earth-only or abandoned. No router or physics needed. |
| Rust seam | `planRoute(grid, start, goal, costFn)` — one pure function, own file, no Cesium imports | Swap in a WASM module later without touching anything else. |
| AI | **No inference at runtime.** Any classification is precomputed offline into a raster and shipped as a layer | No second deployment to break when a judge clicks the link. |
| Auth / multi-user | Simulated crew on a timer. Real second client via `?room=` URL. **No accounts, no fingerprinting** | Login is a rules violation, not just a time sink. |
| UI structure | **One planning screen** with layer presets. No mode switcher. | Modes multiply state and testing for one click each. |
| Scenes | Two: **Map/Plan** (globe + imagery layers) and **Walk** (POV panoramas) | Imagery layers attach to the Globe; the ion 3D tileset is `globe:false`. They cannot be merged. |

### Cut list — do not build these

Bevy rendering · MMGIS self-host · MEDA PDS bundles · MSL RAD parsing · GB-scale GeoTIFFs ·
float32 WMS layers · draping thematic rasters on the 3D tileset · login · AI inference services ·
"anywhere on Mars" as a claim · rover commanding · base-siting scores · step counters · 3 UI modes.

---

## 4. Data layers

Tile template (verified, CORS `*`, no key):
`https://trek.nasa.gov/tiles/Mars/EQ/{dataset}/1.0.0/default/default028mm/{z}/{y}/{x}.jpg`
Level 0 is 2×1 → `GeographicTilingScheme({ numberOfLevelZeroTilesX: 2 })`. Row 0 is north.

| # | Type | Dataset | Prep |
|---|---|---|---|
| 1 | Optical | `curiosity_hirise_mosaic` ImageServer (Gale, 0.25 m) via `exportImage`; global fallback `Mars_Viking_MDIM21_ClrMosaic_global_232m` WMTS | 0 |
| 2 | Topographic | `Mars_MGS_MOLA_ClrShade_merge_global_463m` WMTS + slope derived from `Gale_DEM_SMG_1m` | 0 + ~1 h |
| 3 | Thermal | `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018` WMTS; thermal inertia `thm_ti_100m_8bit` via ASU WMS proxy (stretch) | 0 / 20 min |
| 4 | Spectral | `Hydrous_Mineral_Detections_OMEGA_CRISM_clon0` MapServer — justifies the sampling objective | 0 |
| 5 | Atmospheric | MSL/REMS JSON, sol slider over 4,745 sols | 0 |
| 6 | **Derived (ours)** | Slope-cost traversability surface | ~1 h |
| 7 | **Derived (ours)** | Comms line-of-sight raster to a fixed lander relay | ~2 h |

Radiation is **not** a layer: it is a modelled readout (~0.21 mGy/day surface, Hassler et al. 2014)
labelled "modelled" in the UI. We never parse RAD from PDS.

### Resolution tiers

Gale and Jezero have metre-scale data. Everywhere else gets MOLA ~463 m and THEMIS ~100 m,
which **cannot** support obstacle avoidance for a walking human. Those sites display a
**"coarse data — not walk-scale"** badge. A missing tile (404) is the tier indicator.

---

## 5. Cost model — time-denominated

Every quantity is expressed in **seconds**, so hazards are directly comparable and the
resource budget shares one unit.

```
t(cell)      = step_len / (v0 · slope_penalty · roughness_penalty)
comms(cell)  = max(0, blackout_seconds_along_segment − 60) · k
cost         = t + comms
```

- **Hard mask (impassable):** slope above suit mobility limit · rock abundance above threshold ·
  no-data tiles · modelled dose over budget.
- **Soft cost:** the two terms above, with `a`, `b` exposed as a single **"risk tolerance" slider**.
- **60 s comms grace:** short dropouts are recoverable; longer ones mean loss of telemetry.
  At ~1.5 km/h a 3 m blackout costs ~7 s and is ignored by construction — no special case needed.
- **Router:** A\* over the DEM grid, in `planRoute()`.

---

## 6. Resource model

Parametric and transparent. Output is **% of budget consumed** plus **reserve at return** —
never false-precision kilograms.

- `v0`, suit mass, metabolic rate on flat/rough/slope, suit power draw, PLSS capacity.
- **20% reserve is a hard routing constraint**, not a dashboard number. If no route meets it,
  the app says so and offers the shortest route that does.

Every coefficient lives in `docs/assumptions.md` with a source URL or an explicit `ASSUMED` label.
An unsourced coefficient shown in the UI as if it were fact is a Validity failure.

---

## 7. Open verification spikes

Facts, not decisions. Each can invalidate downstream work; do them before building on them.

1. **Curiosity/Gale traverse GeoJSON** — confirm it exists in the 76 Trek ArcGIS services
   (only `Perseverance_Traverse_Path` is verified).
2. **`exportImage` on `Gale_DEM_SMG_1m`** — does it return float/TIFF, or 8-bit imagery only?
   Slope derivation depends on the answer.
3. **Cesium ion asset `3644333`** on the Community tier — token works? (Walk-mode stretch only.)
4. **Planetographic vs planetocentric** registration at Gale — a ~12 km error at 18°N if wrong.
   Check that the Trek overlay lands on the right pixel.

---

## 8. Definition of done

- Loads cold from a public URL, logged out, on hotel Wi-Fi, no key, no setup.
- Demo route renders with all shipped layers and visible provenance chips.
- Route bends around a no-go zone and a long comms blackout; short dropouts are ignored.
- Survival panel shows reserve-at-return and refuses an infeasible route.
- 7-slide deck (PDF, public link) matches the running app.
- References list is complete; both submission checkboxes ticked; SI field honest.
