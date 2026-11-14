# PLAN — Interplanetary Survival Guide: Martian Map

Status: **decisions frozen**. This document records *what we are building and why*.
Implementation detail lives in code and in `RESEARCH-mars-cesium-feasibility.md`.

Deadline: **Sunday 15 Nov 2026, 23:59 local.** Submit a complete version by **17:00**, then improve and resubmit.
Only the last saved submission is judged.

---

## 1. Product

**Product principle: this is a tool for a human on foot — possibly with a rover — not a rover console.**
Every feature is judged by one question — *does it help a person in a suit decide whether and how
to reach a science target?* The rover is part of the **mission architecture the tool helps you
choose**, not the subject of the app: it carries tools, it can be a parked cache and relay, and a
crewed rover can extend reach by an order of magnitude. The human's survivability always sets the
constraint. Where rover and human needs conflict, the human wins.

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
| Scenes | Three: **Map/Plan** (globe + imagery layers), **Walk** (POV panoramas), **VR HUD** (separate Three.js WebXR scene, P3) | Imagery layers attach to the Globe; the ion 3D tileset is `globe:false`. They cannot be merged. CesiumJS has **no WebXR support**, so VR cannot be Cesium. |

### Cut list — do not build these

Bevy rendering · MMGIS self-host · MEDA PDS bundles · MSL RAD parsing · GB-scale GeoTIFFs ·
float32 WMS layers · draping thematic rasters on the 3D tileset · login · AI inference services ·
"anywhere on Mars" as a claim · rover *commanding* (tracking the real traverse is in) ·
step counters · 3 UI modes · Quest Link

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
- **One router, three mobility profiles.** Same function, same grid, different parameter sets — never
  a second planner:

  | Profile | Speed | Hard mask | Resource model | Reach |
  |---|---|---|---|---|
  | **Foot** | 1–2 km/h | suit slope limit | suit O₂ + battery | ~2 km |
  | **Foot + rover (parked)** | same as foot | suit slope limit | suit + rover cache; relay = rover | ~3–5 km |
  | **Rover transport (concept)** | 5–10 km/h | *vehicle* trafficability | vehicle power + cabin consumables | 10–50 km |

- **The interesting output is the comparison, not any single route.** "This target is 1.4 km — foot
  only, 78% of budget. Add the rover as a cache: 61%. Take the rover: 12 minutes." That is decision
  support, and it is the strongest available answer to the brief's rover question.
- **Label the crewed rover "concept vehicle" in the UI**, with parameters from NASA concept studies.
  Never imply flight heritage, and never use MSL/Perseverance speeds for transport — they average
  ~0.03 km/h and would take a hundred hours to cross the demo route.

---

## 6. Resource model

Parametric and transparent. Output is **% of budget consumed** plus **reserve at return** —
never false-precision kilograms.

- `v0`, suit mass, metabolic rate on flat/rough/slope, suit power draw, PLSS capacity.
- **Vehicle variant** for the rover profile: vehicle speed, trafficability slope limit, power draw,
  cabin consumables. Separate coefficient block, same output format.
- **Pairs:** run the budget once per crew member; a route is feasible only if **every** member makes
  the reserve, and the pace is set by the slowest/most-constrained one. That is ~20 lines and it is
  the brief's "astronauts might work in pairs" made functional rather than decorative.
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

---

## 9. Priority ladder

**Rule: no P1 work starts until every P0 acceptance test passes. No P2 work starts until P1 is green.**
A P2 that half-exists is worse than a P2 that doesn't, because it steals hours from P0.

### P0 — the demo fails without these

| # | Feature | Acceptance test |
|---|---|---|
| 1 | Cesium Mars globe, `Ellipsoid.MARS`, Gale 25 cm optical + MOLA topographic | Loads cold from a public URL and flies to Gale |
| 2 | Layer panel with opacity + provenance chips | Every layer shows dataset, mission, resolution, date |
| 3 | POI markers: Viking 1 & 2, landing sites, waypoints, real rover traverse | Clicking a POI opens its detail card |
| 4 | Route planner: A\* with **human suit-mobility** cost + slope hard mask | Route visibly bends around a no-go zone |
| 5 | ETA + resource budget + 20% reserve check | Infeasible route is refused, not drawn |
| 6 | Comms LOS layer + blackout term in routing | Long blackout is avoided; 3 m dropout is ignored |

### P1 — only after all P0 green

| # | Feature | Cost | Note |
|---|---|---|---|
| 7 | Simulated crew + peer stats (O₂, battery, distress) | 2 h | Timer-driven agents |
| 8 | **Real peer broadcasting** via public MQTT-over-WebSocket broker + `?room=` | 2–3 h | No backend to deploy. Random room UUID. Falls back to simulation. |
| 9 | POV panorama viewer at waypoints | 2 h | Brief explicitly asks for this |
| 10 | Atmosphere sol slider (live MSL/REMS) | 1 h | Measured, never "forecast" |
| 11 | Local solar time + sol clock | 30 min | From longitude + mission sol |
| 12 | HUD overlay (2D CSS, visor framing) | 1 h | Cheap version of the HUD ask |
| 13 | Layer presets (Terrain / Thermal / Hazards) | 1 h | Replaces the three-mode idea |

### P2 — pick **one**, Sunday morning, only if P1 green

Thermal inertia proxy (20 min, cheapest) · precomputed terrain-classification raster ·
base-siting suitability score · area-of-interest search + save explored points ·
ion 3D walk mode (needs a working token).

*`tatharis n shi classification` from the brainstorm is undefined — get one line from the team
before it can be slotted anywhere.*

### P3 — stretch, or deck-only

**VR HUD** (Three.js WebXR, separate scene, 4–6 h) · rover commanding mock.

**VR gate:** starts only if P0 and P1 pass and ≥4 h remain. If it doesn't ship, one screenshot of it
still earns the slide. Do not let it touch the Cesium app.

---

## 10. Data acquisition — nothing gets lost

The teammates' worry is real, so here is the byte budget. **Six of seven layers need zero bytes.**

| Layer | Acquisition | Bytes |
|---|---|---|
| Optical, topographic (global), thermal, spectral, atmosphere | Live endpoints (WMTS / ArcGIS / JSON) | **0** |
| Gale 25 cm optical | `exportImage` on demand | **0** |
| Slope surface | DEM **corridor** at 5 m/px, not the 3.87 GB file | ~4 MB |
| Comms LOS | Computed from that corridor | ~1 MB |

Total download budget: **~5 MB, once.** Compare with 3.87 GB for the Gale DEM mosaic — which we never
touch. The mechanism is `exportImage` with a bbox: *you ask the ImageServer for the corridor at the
resolution you need*, you don't download the product.

### Fallback chain — every layer, every time

`local cached raster → live endpoint → coarse global layer → labelled "unavailable"`

- **Derived rasters are committed to the repo.** Slope and LOS ship as PNGs in `public/rasters/`.
  The demo never depends on a network fetch at judge time.
- **Degrade visibly, never silently.** If a live layer fails, the app drops to the coarse global
  layer and shows the "coarse data" badge. The layer does not disappear.
- **Data points are not rasters.** POIs, waypoints, traverse segments and attributes are a few KB of
  JSON. They are committed too, so a raster failure never costs you a data point.
- **If a download is late, the feature ships with its fallback rung.** No P0 item depends on a
  download finishing.

---

## 11. VR — what it actually is

CesiumJS has **no WebXR support** (roadmap, no timeline). So:

- **VR HUD is a separate Three.js WebXR scene**, opened from a link, running in the **Quest 3 browser**
  — not Quest Link, which adds a PC, a cable and a PCVR runtime for no benefit.
- It consumes `route.json` exported by the planner: local terrain patch (a few hundred metres),
  route polyline, waypoint markers, floating HUD panels (O₂, battery, ETA, blackout warning),
  360° panorama at waypoints.
- It is a **third renderer over the same data**, which is exactly what the `planRoute()` seam buys us.
- P3, gated, and it never touches the Cesium app.
