# PLAN — Interplanetary Survival Guide: Martian Map

Status: **decisions frozen, progress tracked in §0.** §1–§13 record *what we are building and why*;
§0 records *where we actually are* and is the part to keep current.
Implementation detail lives in code, `docs/`, and `RESEARCH-mars-cesium-feasibility.md`.

Deadline: **Sunday 15 Nov 2026, 23:59 local.** Submit a complete version by **17:00**, then improve and resubmit.
Only the last saved submission is judged.

Legend used below: ✅ done · 🟡 partly done / differs from plan · ❌ not started

---

## 0. Where we are — Sun 15 Nov 2026, 03:30

### 0.1 What exists and works (all in `web/`, served by `web/serve.mjs`)

| Area | State | Notes |
|---|---|---|
| Mars globe | ✅ | CesiumJS 1.147, `Ellipsoid.MARS`, NASA Trek imagery (Viking colour, MOLA, MOLA+HRSC colour relief, Gale HiRISE mosaic), searchable Trek layer catalog, per-layer opacity and order, click-a-point pixel readout |
| 3D terrain | ✅ | Real heights, not a basemap: MOLA MEGDR 4→128 px/° + USGS HRSC/MOLA blend (~200 m) streamed and cached by the server, finer as you zoom; exaggeration ×1–10; vertex-normal shading |
| Lighting & time | ✅ | Mars24 clock at the view centre (local solar time, sun elevation, season), real-sun or hillshade shading, fixed time-of-day option, Mars-tuned atmosphere (sky, haze, fog) with performance settings |
| Spots (POIs) | ✅ | 2,128 global spots: 73 mission spots (landers, rovers, crash sites, Curiosity boxwork target, 8 Curiosity + 56 Perseverance 360° panoramas) and **all 2,055 IAU-named features** (USGS Gazetteer). Kinds with colours, search, tag filter (all/any), All/Global/Custom, size-aware pin visibility, far-side pins faded |
| Custom spots | ✅ | Add/edit/delete with own kinds, colours, description, images, tags, source; saved by the server (`web/data/custom`) or in the browser; export/import JSON. *Infrastructure that §13 crew reports can reuse.* |
| Rover traverse | ✅ | Curiosity PLACES traverse (1,349 points) as a terrain-following line; spike 1 resolved by this |
| Route planner | 🟡 | Mehloul's `pathfinding.js`: A* + Theta* over MOLA height tiles, **slope hard mask** (5–45° slider, red no-go overlay), coarse→fine corridor refinement, Bézier smoothing. UI: named stops from any spot / map click / random nearby spot, drag-to-reorder, return-to-start loop, explicit **Calculate route** with live progress. **Gap:** cost is distance, not time; ~2.6 km grid (MOLA z6) is not walk-scale |
| UI shell | ✅ | Tabbed dock (Settings / Layers / Spots / Path), spot cards with details, galleries, "Add to route" |
| Install / run | ✅ | `setup.ps1 [-WebOnly]`, `setup.sh [--with-rust]`, `start-viewer.bat/.sh` (Node ≥ 18, `npm ci`) |
| Hazard forecast (Python) | 🟡 | Issam's `forecast/`: offline physics-informed ML pipeline (MGCM + OpenMARS → dust/wind/cold/heat risk GeoTIFF). **Not wired into the app**, and conflicts with §2/§4 wording — see 0.5 |

### 0.2 P0 status (the demo fails without these)

| # | Feature | Status | What is missing |
|---|---|---|---|
| 1 | Globe + Gale optical + MOLA | ✅ | Must also load from the **public link** (0.3) |
| 2 | Layer panel + provenance chips | 🟡 | Panel, opacity and a mission/resolution note per layer exist. **No date** and no uniform chip (dataset · mission · resolution · date) |
| 3 | POI markers + detail card + real traverse | ✅ | — |
| 4 | Route planner with suit-mobility cost + slope mask | 🟡 | Slope mask ✅, bends around no-go ✅. Cost must become **time** (§5: `step_len / (v0 · slope_penalty)`), with `MobilityProfile` + `crew[]` arguments |
| 5 | Route card: ETA, O₂ / water / battery `timeline[]`, 20% reserve, why-this-route, warnings + caveats | ❌ | Biggest P0 gap. Route status today is distance only |
| 6 | Comms line-of-sight + blackout term | ❌ | Needs a relay point + LOS over the same height grid |
| 7 | VR HUD (Three.js WebXR, reads `route.json`) | ❌ | Panorama cards link to external 360° viewers; no `route.json`, no VR scene |

### 0.3 Hard constraints status

| Constraint | Status |
|---|---|
| Public link, no login, **no setup** | ❌ **Blocking.** The app runs only with `node serve.mjs` locally: 3D terrain, route planning, the Trek catalog and custom-spot saving all come from the server. Nothing is deployed yet |
| ≤ 7 slides or ≤ 30 s video | ❌ Deck not started |
| NASA data core, with provenance | 🟡 Core yes; provenance chips incomplete (P0 #2) |
| ≥ 3 data kinds | 🟡 Optical, topographic (+ derived slope) shipped. Thermal / spectral layers exist in the Trek catalog but are not wired as named views; atmospheric not shipped |
| All external resources referenced | 🟡 `docs/markers.md` and `docs/curiosity-data.md` list sources; no single References list yet (Cesium, Trek, PDS MOLA, USGS HRSC blend, USGS Gazetteer, PLACES, Mastcam-Z, Mars24…) |
| AI use declared | ❌ Not written. Claude Code wrote a large part of the viewer; say so |

### 0.4 What to do next, in order

**Before 17:00 (first complete submission) — the minimum that makes the entry valid and demo-able:**

1. **Deploy a public link (≈ 2 h, owner: whoever knows hosting).** Two options, pick one now:
   - **A. Host `serve.mjs` as-is** on a free Node host (Render / Fly / Railway) with a small disk. Zero code changes; first visitors trigger NASA downloads, so warm the cache for Gale + Jezero before submitting. Simplest.
   - **B. Static only (what §2 originally said):** a script crawls `/terrain/z/x/y` for Gale and Jezero (levels 0–11) and the catalog into static files; set `USE_PROXY=false` paths to read them. More robust at judge time, ~3–4 h.
2. **Route card v1 (P0 #5, ≈ 3 h):** time-based cost (foot profile, `ASSUMED` speed-by-slope table from `docs/assumptions.md`), ETA, O₂/water/battery % per step, 20% reserve check that **refuses** the route, limiting consumable, straight-line baseline, the four standing caveats (§12). Crew of two hard-coded (P0 architecture rule).
3. **Provenance chips (P0 #2, ≈ 1 h):** one chip per layer and per spot source: dataset · mission · resolution · date.
4. **Walk-scale honesty (≈ 30 min):** on routes, show "coarse data — not walk-scale" (MOLA ~2.6 km cells at z6). Optionally refine the last leg on the 200 m blend. The Gale 1 m DEM (spike 2) is out of reach today.
5. **Deck (7 slides) + References + AI declaration (≈ 2 h, can run in parallel):** problem → site → data layers → route + survival card → spots/exploration → limits/caveats → team/references.

**After 17:00 (resubmit before 23:59), in this order:**

6. Comms LOS + blackout term (P0 #6, ≈ 2 h).
7. VR HUD minimal (P0 #7, ≈ 4 h, parallel track): freeze `route.json` first (§11), export it from the Path tab, laptop mouse-look fallback.
8. View presets with legends (P1 #13): Satellite / Terrain / Thermal / Hazard / Science; wire THEMIS and OMEGA/CRISM from the catalog.
9. Crew reports (P1 #9) on top of custom spots: an "Avoid / Slow" effect that the router reads.
10. Daylight margin (P1 #14): the clock already has local solar time and sun elevation; add the sunset warning to the route card.

### 0.5 Decisions the team must make today

- **Hosting:** option A or B above. Nothing else matters if the link does not open.
- **Forecast pipeline vs the plan.** §2 says "no AI inference at runtime" and §5/§6 say atmosphere is "measured, never forecast". Issam's pipeline is offline, so it *can* fit the "precomputed offline raster, shipped as a layer" rule, but only if its GeoTIFF output is shipped as a labelled layer ("modelled hazard risk, not a forecast of record") and the SI declaration covers it. Otherwise keep it out of the submission.
- **Bevy / Rust leftovers** (`Cargo.toml`, `src/`, `target/`): out of the demo path since §3; delete or leave untouched.
- **Route resolution claim:** the planner runs on ~2.6 km MOLA cells. Either refine on the 200 m blend or say plainly that it is regional-scale planning.

---

## 1. Product

**Product principle: this is a tool for a human on foot — possibly with a rover — not a rover console.**
Every feature is judged by one question — *does it help a person in a suit decide whether and how
to reach a science target?* The rover is part of the **mission architecture the tool helps you
choose**, not the subject of the app: it carries tools, it can be a parked cache and relay, and a
crewed rover can extend reach by an order of magnitude. The human's survivability always sets the
constraint. Where rover and human needs conflict, the human wins.

The brief asks two things in one sentence: could **rovers or other robotic systems carry the crew and
their tools**, and could **astronauts work in pairs to accomplish more science**. This tool answers both
with computed numbers (profile comparison, §5; pair mode, §6), not a slide bullet.
**The planning unit is a crew of two. The rover carries both.**

A single-page **mission-planning and Marswalk-survival view** of one hyperlocal site on Mars.

An astronaut (or the habitat console) picks a science target, sees the terrain layered with
NASA data, gets a route that respects suit mobility, terrain hazards and comms blackout,
and is told — before they step outside — whether the oxygen and battery budget actually
gets them home.

**Demo site:** Gale crater / Glen Torridon, boxwork formations (the science objective named
in the challenge brief). **Architecture is site-agnostic**; a tiered site registry lets other
locations load, labelled with their real data resolution. *(Status: the globe, terrain, spots and
router already work anywhere on Mars; Gale and Jezero have the richest spot data.)*

---

## 2. Hard constraints (pass/fail, not preferences)

| Constraint | Consequence | Status (§0.3) |
|---|---|---|
| Every project link must be public — no login, no registration, no setup | Public hosting. No auth, ever. No local `cargo run` / `node serve.mjs` for judges. | ❌ |
| Demo is **either** ≤7 slides **or** ≤30 s video | 7-slide deck, exactly 7 including title. Over the limit = scored 1, not evaluated. | ❌ |
| NASA data must be a *core* component, not decorative | Provenance chip on every layer: dataset, mission, resolution, date. | 🟡 |
| At least 3 kinds of data | Planned: **5 measured** (optical, topographic, thermal, spectral, atmospheric) + 1 modelled (radiation). | 🟡 |
| All external resources listed in References | Every dataset, library, basemap, font, model, AI tool. | 🟡 |
| SI (AI) use must be declared; AI media watermarked | Declared honestly. No AI inference in the runtime. | ❌ |

---

## 3. Architecture — as built

| Decision | Plan | As built | Why it changed |
|---|---|---|---|
| Renderer | CesiumJS 1.147, `Ellipsoid.MARS` | ✅ same | — |
| Framework | Vite + TypeScript | Plain `web/index.html` (ES modules) + `web/pathfinding.js`, no build step | Faster to iterate; nothing to build when deploying |
| Server | none (static) | `web/serve.mjs` (Node ≥ 18, built-ins only): Trek tile proxy + disk cache, Trek catalog, **terrain service** (MOLA MEGDR + HRSC blend → quantized-mesh height tiles), point elevation, custom-spot API | Real 3D terrain and routing need heights; NASA files are GB-scale, so the server streams byte ranges and caches. **This is why deployment is now the top risk (§0.3)** |
| Rust / Bevy | Out of the demo path | Still in repo, unused | Delete or ignore (§0.5) |
| Router seam | `planRoute(grid, start, goal, costFn)`, pure, no Cesium | `planTerrainRoute(grid, start, goal, { maxSlopeDeg, onProgress })` in `pathfinding.js`, no Cesium imports | Same seam; needs a `costFn` / `MobilityProfile` argument for §5 |
| AI | No inference at runtime | ✅ none in the web app; `forecast/` is offline Python (§0.5) | — |
| Auth / multi-user | Simulated crew; `?room=` later | None yet | — |
| UI structure | One planning screen, layer presets | One screen with a tabbed dock (Settings / Layers / Spots / Path); presets (views) not yet | — |
| Scenes | Map/Plan · Walk (POV panoramas) · VR HUD (Three.js) | Map/Plan ✅ · panoramas as external 360° links 🟡 · VR ❌ | — |

### Cut list — do not build these

Bevy rendering · MMGIS self-host · MEDA PDS bundles · MSL RAD parsing · GB-scale GeoTIFF downloads in the
browser · float32 WMS layers · draping thematic rasters on the 3D tileset · login · AI inference services ·
"anywhere on Mars" as a claim · rover *commanding* (tracking the real traverse is in) · step counters ·
3 UI modes · Quest Link · other robotic systems (one deck bullet as future work, no code) · invented vitals
(heart rate, fatigue) · a CO₂ tank

---

## 4. Data layers

Tile template (verified, CORS `*`, no key; the extension is per layer, `.jpg` or `.png`):
`https://trek.nasa.gov/tiles/Mars/EQ/{dataset}/1.0.0/default/default028mm/{z}/{y}/{x}.{ext}`
Level 0 is 2×1 → `GeographicTilingScheme({ numberOfLevelZeroTilesX: 2 })`. Row 0 is north.

| # | Type | Dataset | Status |
|---|---|---|---|
| 1 | Optical | `curiosity_hirise_mosaic` (Gale, ~0.6 m/px via WMTS z16; true 25 cm needs `exportImage`); global `Mars_Viking_MDIM21_ClrMosaic_global_232m` | ✅ |
| 2 | Topographic | MOLA colour relief + **real heights** (PDS MOLA MEGDR 4–128 px/°, USGS HRSC/MOLA blend 200 m) | ✅ |
| 2b | **Derived (ours)** | Slope no-go mask from the router (red overlay) | ✅ |
| 3 | Thermal | `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018` (in the Trek catalog, addable); thermal inertia stretch | 🟡 not a preset |
| 4 | Spectral | `Hydrous_Mineral_Detections_OMEGA_CRISM_clon0` | ❌ |
| 5 | Atmospheric | MSL/REMS JSON, sol slider | ❌ (see `forecast/`, §0.5) |
| 6 | **Derived (ours)** | Slope-cost traversability surface (time) | ❌ (mask exists, cost is distance) |
| 7 | **Derived (ours)** | Comms line-of-sight raster to a fixed relay | ❌ |
| 8 | Reference points | USGS Gazetteer (2,055 IAU names), MSL PLACES traverse, Mastcam-Z panorama catalog, mission landing sites | ✅ |

Radiation is **not** a layer: it is a modelled readout (~0.21 mGy/day surface, Hassler et al. 2014)
labelled "modelled" in the UI. We never parse RAD from PDS. It is readout-only and never enters the
router (§6: ~70 µGy over an 8 h EVA, the same everywhere at walk scale).

### Resolution tiers

Gale and Jezero have metre-scale imagery. Heights in the app are MOLA (~460 m–1.85 km) and the
HRSC/MOLA blend (~200 m); the router plans on MOLA z6 (~2.6 km cells). None of these support obstacle
avoidance for a walking human, so routes must carry a **"coarse data — not walk-scale"** badge until a
metre-scale DEM (spike 2) is wired in.

### Views and legends (P1 #13, not built)

A **view** is a preset of `{layers on, opacity, basemap dimmed or off, legend}`. It is one state change on
the layer panel, not a mode.

| View | What it shows |
|---|---|
| **Satellite** | Gale optical only |
| **Terrain** | MOLA colour relief + slope surface |
| **Thermal** | THEMIS thermal; thermal inertia if the P2 pick ships |
| **Hazard** | Slope-cost traversability + comms blackout + time-to-safety + crew reports + no-go mask over dimmed optical |
| **Science** | OMEGA/CRISM hydrous detections + target markers over optical |

- **Heatmap-only** is a "basemap off" toggle on any view.
- **Every layer has a legend.** Exact for our derived rasters; for remote layers from the service's
  metadata, else "relative / service colour scale". No invented numbers on a legend.

---

## 5. Cost model — time-denominated (status: ❌, router uses distance + slope mask)

Every quantity is expressed in **seconds**, so hazards are directly comparable and the
resource budget shares one unit.

```
t(cell)      = step_len / (v0 · slope_penalty · roughness_penalty)
comms(cell)  = max(0, blackout_seconds_along_segment − 60) · k
cost         = t + comms
```

- **Hard mask (impassable):** slope above suit mobility limit (✅ built) · DEM roughness above threshold ·
  no-data tiles · crew-reported Avoid zones (§13) · walk-back time over the limit (§6).
- **Soft cost:** the two terms above, with `a`, `b` exposed as a single **"risk tolerance" slider**.
  Crew-reported Slow zones multiply `t` (§13).
- **60 s comms grace:** short dropouts are recoverable; longer ones mean loss of telemetry.
- **Router:** A\* / Theta\* over the DEM grid (✅ built in `pathfinding.js`).
- **One router, three mobility profiles** — same function, different parameter sets, never a second planner:

  | Profile | Speed | Hard mask | Resource model | Reach |
  |---|---|---|---|---|
  | **Foot** | 1–2 km/h | suit slope limit | suit O₂ + battery | ~2 km |
  | **Foot + rover (parked)** | same as foot | suit slope limit | suit + rover cache; relay = rover | ~3–5 km |
  | **Rover transport (concept)** | 5–10 km/h | *vehicle* trafficability | vehicle power + cabin consumables | 10–50 km |

- **Tools are a payload:** `tool_kg` raises metabolic cost on foot, waits at the cache with a parked rover,
  rides in the vehicle in the rover profile.
- **The cabin is the safe haven.** Only a *pressurized* concept vehicle is modelled; rover breakdown is not.
- **Comparison card:** one row per profile — feasible?, ETA, % budget, reserve at return, hand-carried
  payload — for the selected target, crew of two. Infeasible rows stay visible with the reason.
- **Label the crewed rover "concept vehicle"**, parameters from NASA concept studies. Never use
  MSL/Perseverance speeds for transport (~0.03 km/h).

---

## 6. Resource model (status: ❌)

Parametric and transparent. Output is **% of budget consumed** plus **reserve at return** —
never false-precision kilograms.

- **Three depleting consumables: O₂, cooling water, battery** (Apollo walk-back practice), each a % of
  design capacity (8 h EVA at 1000 BTU/h). O₂ and water ∝ metabolic rate; battery flat draw (`ASSUMED`).
  The **limiting consumable** is named in the UI.
- **Metabolic rate** = f(speed, slope, load = suit mass + `tool_kg`, 0.38 g): SEXTANT-style speed-by-slope
  table plus a load multiplier, every coefficient `ASSUMED` until sourced (spike 6).
- **Vehicle variant** for the rover profile (DRA 5.0 small pressurized rover: crew of two, ~100 km range;
  everything else `ASSUMED`).
- **Pairs — crew of two is the default planning unit.** Feasible only if **every** member keeps the reserve;
  pace set by the most constrained one. Benefit side: shared `tool_kg`, shared time-at-stop, output =
  *science stops completed inside the reserve*, solo vs pair, labelled "modelled".
- **20% reserve is a hard routing constraint** (per member). If no route meets it, say so and offer the
  shortest route that does.
- **Walk-back constraint:** Dijkstra from the safe haven over the same cost grid → time-to-safety raster;
  a route is feasible only if walk-back time stays within `walkback_limit_s` (default 60 min, NASA Mars PLSS
  study; 30 min variant from the 2026 suit-mass study). Also a heatmap layer with an exact legend.
- **Live tanks (simulated):** route output carries `timeline[]` (O₂ / water / battery %, walk-back margin);
  a playback scrubber moves the astronaut and the gauges follow. Labelled "simulated".

### What we model, read out, and leave out

| Metric | Verdict | Basis |
|---|---|---|
| O₂ level | **Model** | Burn ∝ metabolic rate (NASA PLSS studies). |
| Cooling water | **Model** | Same; % only, `ASSUMED`. |
| Battery | **Model** | Flat draw; xEMU batteries outlasted 8 h in chamber tests. |
| Walk-back time + margin | **Model** | Apollo practice; V-SUIT (ICES 2018). |
| Daylight remaining | **Model** | Geometry only; the Mars24 clock already gives local solar time and sun elevation. |
| Radiation dose | **Readout only** | ~0.21 mGy/day at Gale (RAD, Hassler 2014), uniform at walk scale; SPEs not forecastable. |
| Ground / air temperature | **Readout only** | REMS record, historical. |
| CO₂ scrubber tank | **Leave out** | Regenerative swingbeds. |
| Heart rate, fatigue, vitals | **Leave out** | No validated route-level model. |
| Wind, dust loading, soil strength | **Leave out** | No walk-scale data; soil/rock hazards come from crew reports (§13). |
| Rock abundance | **Leave out as a layer** | HiRISE resolves ≳1 m boulders only. |

Every coefficient lives in `docs/assumptions.md` with a source URL or an explicit `ASSUMED` label
(**status: mostly empty — fill it while building P0 #5**).

---

## 7. Verification spikes

| # | Spike | Status |
|---|---|---|
| 1 | Curiosity/Gale traverse data | ✅ Resolved: MSL PLACES `localized_pos.csv` → GeoJSON (`docs/curiosity-data.md`), drawn as the Rover road |
| 2 | `exportImage` on `Gale_DEM_SMG_1m`: float or 8-bit? | ❌ Open. Worked around with the 200 m HRSC blend; walk-scale slope still depends on it |
| 3 | Cesium ion asset `3644333` | — Not needed so far (terrain is self-served) |
| 4 | Planetographic vs planetocentric at Gale | ✅ Resolved: Trek HiRISE service is IAU 2015 planetocentric (wkid 104905); spots use planetocentric; Gale is ~5°S, not 18°N |
| 5 | Concept-vehicle parameters (DRA 5.0) | ❌ Open (~30 min) |
| 6 | Resource-model sources → `docs/assumptions.md` | ❌ Open (~1 h) — needed for P0 #5 |

---

## 8. Definition of done (checked = true today)

- [ ] Loads cold from a public URL, logged out, no key, no setup.
- [ ] Demo route renders with all shipped layers and visible provenance chips.
- [x] Route bends around a no-go (slope) zone. [ ] …and around a long comms blackout; short dropouts ignored.
- [ ] Survival panel shows reserve-at-return and refuses an infeasible route.
- [ ] Route card explains itself (cost breakdown, straight-line baseline, detour notes) with warnings and standing caveats.
- [ ] *If P1 #8–10 shipped:* time-to-safety raster, walk-back margin, crew report bends the route.
- [ ] *If P1 #11–12 shipped:* Foot / Foot + rover / Rover (concept) comparison; per-member refusal.
- [ ] VR HUD: public link enters VR on Quest 3; same link works on a laptop with mouse-look.
- [ ] 7-slide deck (PDF, public link) matches the running app.
- [ ] References complete; both submission checkboxes ticked; SI field honest.

---

## 9. Priority ladder

**Rule: no P1 work starts until every P0 acceptance test passes. No P2 work starts until P1 is green.**
*(Reality check: several P1/P2-type features were built before P0 #5–7 — spots, atmosphere, clock,
custom spots. From now on the rule applies strictly: §0.4 order.)*

### P0 — the demo fails without these (status in §0.2)

| # | Feature | Acceptance test |
|---|---|---|
| 1 | Cesium Mars globe, Gale optical + MOLA topographic | Loads cold from a public URL and flies to Gale |
| 2 | Layer panel with opacity + provenance chips | Every layer shows dataset, mission, resolution, date |
| 3 | POI markers: landing sites, waypoints, real rover traverse | Clicking a POI opens its detail card |
| 4 | Route planner: A\* with **human suit-mobility** cost + slope hard mask | Route visibly bends around a no-go zone |
| 5 | **Route card:** ETA, consumables (O₂ / water / battery, `timeline[]`), 20% reserve, why-this-route basics, warnings + standing caveats | Infeasible route is refused, not drawn; a feasible route shows its limiting consumable, why it detours, and the standing caveats |
| 6 | Comms LOS layer + blackout term in routing | Long blackout is avoided; 3 m dropout is ignored |
| 7 | **VR HUD (minimal)** — Three.js WebXR scene reading `route.json` | Enters VR in the Quest 3 browser; same link works on a laptop |

**P0 architecture rule:** write #4–#5 against a `MobilityProfile` argument and a `crew: Member[]` array.
P0 ships Foot × 2 hardcoded; P1 #11–12 are then config and UI, not a refactor.

**P0 #7 is a parallel track:** freeze the `route.json` schema first (§11), hand-write a fixture, build the
scene against it, swap in the real export later.

### P1 — only after all P0 green

| # | Feature | Status | Note |
|---|---|---|---|
| 8 | Time-to-safety raster + walk-back constraint + playback scrubber | ❌ | §6 |
| 9 | Crew field reports (Avoid / Slow zones, re-plan, GeoJSON) | 🟡 | Custom spots give storage, kinds, tags, images and export/import; add the routing effect |
| 10 | Why-this-route, full (what-if variants, along-route strip) | ❌ | §12 |
| 11 | Mobility profile comparison | ❌ | Same router, three parameter sets |
| 12 | Pair mode | ❌ | Per-member budgets |
| 13 | View selector with legends | ❌ | §4 |
| 14 | Local solar time + daylight margin | 🟡 | Clock, sun elevation and fixed-time lighting done; sunset warning on the route card missing |
| 15 | POV panorama viewer at waypoints | 🟡 | 64 panorama spots link to NASA / ASU 360° viewers; no in-app viewer |
| 16 | Atmosphere sol slider (MSL/REMS) | ❌ | Measured, never "forecast" |
| 17 | Real peer broadcasting (`?room=`) | ❌ | First to drop |

### P2 — pick **one**, only if P1 green

Thermal inertia proxy · precomputed terrain-classification raster (the `forecast/` GeoTIFF could fill
this slot if labelled "modelled") · base-siting suitability score · area-of-interest search + save explored
points (**largely covered by custom spots**) · ion 3D walk mode.

### P3 — stretch, or deck-only

Rover commanding mock.

---

## 10. Data acquisition — nothing gets lost

The original budget (~5 MB, all live endpoints) changed when 3D terrain was added:

| Data | How it is acquired now | Size |
|---|---|---|
| Trek imagery, catalog | Live WMTS through the server's proxy, disk-cached (`web/.tile-cache`) | on demand |
| MOLA MEGDR heights | HTTP Range reads from NASA PDS, chunk-cached in `web/data` (resumable, self-repairing) | 4/16/32 px/° global + 64/128 px/° on demand (up to ~2 GB if fully cached) |
| HRSC/MOLA blend 200 m | HTTP Range reads of the 11 GB USGS GeoTIFF on S3, 1024×64 blocks cached in `web/data/hrsc200` | on demand |
| Spots, traverse, panoramas, IAU names | Committed JSON/GeoJSON in `web/public/data` | ~5 MB |
| Custom spots | `web/data/custom` (git-ignored) or browser storage; export/import JSON | user data |

### Fallback chain — every layer, every time

`local cached raster → live endpoint → coarse global layer → labelled "unavailable"`

- **Degrade visibly, never silently.** Missing terrain falls back to the flat ellipsoid; route planning says
  "Start the local viewer server" without one — on the public deployment this must never appear (§0.4 #1).
- **Data points are committed.** POIs, traverse and names never depend on a network fetch.
- For a static deployment (option B), pre-bake the terrain tiles for Gale and Jezero so the judge's
  click needs no NASA download.

---

## 11. VR HUD — must ship (status: ❌)

CesiumJS has **no WebXR support**, so:

- **Separate Three.js WebXR scene**, opened from a link in the **Quest 3 browser** (not Quest Link).
- **It must work without a headset:** "Enter VR" only where `immersive-vr` is supported; otherwise
  mouse-look. That laptop view is also the HUD demo.
- **Consumes `route.json`.** Minimum fields: `profile`, `crew[]` (reserve per member), `path[]` as
  lon/lat/elevation, `waypoints[]`, `blackout[]`, `eta_s`, `timeline[]` (O₂ / water / battery % and
  walk-back margin per step), `warnings[]`, `reports[]`, and a local `terrain` height grid.
  **Freeze this schema before anyone builds against it.** The Path tab already has stops, the path
  (`routeRawPath` with elevations) and the height grid to export.
- **Ships with a committed demo `route.json`**; "Open in VR" hands over the live route via same-origin
  storage and falls back to the committed one.
- **Minimum scope (~4 h):** terrain patch, route line, waypoint markers, four floating panels
  (consumables, ETA, walk-back margin, warnings). Stretch: 360° panorama at waypoints.
- **HUD panels are canvas textures on planes, not DOM.** Add Three.js to References.

---

## 12. Explaining the route and declaring its limits (status: ❌, P0 #5 basics first)

Trust is the product. The route card must answer *why this route* and *what is still risky*. No AI is
involved: every sentence is a template filled from planner output.

### Why this route

- **Cost breakdown:** stacked bar of the route's seconds by term (flat travel, slope, roughness, comms,
  crew slowdowns), limiting consumable named.
- **Straight-line baseline**, always computed (the Path tab already shows straight-line km per leg).
- **Detour notes:** one generated sentence per place the route leaves the straight line.
- **Route coloured by dominant cost driver** + along-route strip (elevation, slope, blackout, consumables,
  walk-back margin vs distance), hover-linked to the map and VR.
- **What-if variants (P1 #10):** dashed grey REJECTED routes inside the Why panel only.
- **Code seam:** the router returns per-step cost components; `explain()` lives in its own file, no Cesium.

### Warnings — declared even when the route is feasible

Rule-based, INFO / CAUTION / WARNING, in the route card, on the map, and in `route.json`. Every threshold is
`ASSUMED` and listed in `docs/assumptions.md`.

| Rule | Level | Example text |
|---|---|---|
| Reserve at return under 30% (but ≥ 20%) | CAUTION | "Reserve at return 24%: thin." |
| Limiting consumable | INFO | "Water limits this EVA, not O₂." |
| Walk-back margin under 15 min anywhere | CAUTION | "Walk-back margin is 9 min at waypoint 3." |
| Max slope within 20% of the suit limit | CAUTION | "3 segments steeper than 12° (limit 15°)." |
| Blackout remains on route | WARNING | "Blackout 4 min 10 s between waypoints 2 and 3." |
| Dropouts under the 60 s grace | INFO | "5 dropouts, 38 s total, within grace." |
| Ends within 45 min of sunset | CAUTION | "Return ends 30 min before sunset." |
| Passes within 30 m of an unverified crew report | CAUTION | "Passes 20 m from crew report #2." |
| Pair: weakest member | INFO | "Crew B sets the pace." |
| Concept rover profile | INFO | "Concept vehicle: parameters assumed." |
| **Coarse terrain (new)** | CAUTION | "Planned on ~2.6 km MOLA cells: not walk-scale." |

**Standing caveats — shown on every route, not dismissible:**
- "Orbital imagery resolves boulders of about 1 m and up. Smaller rocks, loose sand and soft ground are not
  on this map." (HiRISE; Hood et al. 2022.)
- "Atmosphere and temperature are past measurements, not forecasts."
- "Solar particle events cannot be forecast here. Shelter procedure is not modelled."
- "Consumable levels are simulated from assumed coefficients."

---

## 13. Crew field reports — the astronaut updates the map (status: 🟡 storage exists)

Orbit cannot see everything (HiRISE resolves ~1 m boulders and up). Apollo 17's orange glass at Shorty
Crater was not visible remotely (NTRS 20090036808). So the map is not read-only.

- **Add a report:** tap the map, drop a circle or polygon, pick a type (Rock field · Soft ground · Drop or
  crater edge · Obstacle · Science note) and an effect: **Avoid** (hard mask) or **Slow** (cost multiplier,
  `ASSUMED`). Timestamp = sol + local solar time; author Crew A or B. No accounts.
  *Built today: custom spots already give a point with kind, colour, description, images, tags, date and
  export/import. Missing: radius/polygon, the Avoid/Slow effect, and the router reading it.*
- **Re-plan immediately:** reports are rasterised onto the grid and reach the router through `costFn`.
  The Why panel cites them.
- **Reports can only add risk** — never lift a physics-based mask. Deleting your own report is allowed.
- **Visible as data, with provenance:** "source crew field report · as entered · sol N · unverified by orbit".
- **Storage without a backend:** browser storage + GeoJSON export/import (already built for custom spots).
- **Demo seed:** 2–3 reports labelled **SIMULATED crew report (demo)**, with a "clear demo reports" button.
- **VR:** reports travel in `route.json` (`reports[]`).
