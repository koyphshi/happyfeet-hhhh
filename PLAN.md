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
| Scenes | Three: **Map/Plan** (globe + imagery layers), **Walk** (POV panoramas), **VR HUD** (separate Three.js WebXR scene, **P0 #7 — must ship**, §11) | Imagery layers attach to the Globe; the ion 3D tileset is `globe:false`. They cannot be merged. CesiumJS has **no WebXR support**, so VR cannot be Cesium. |

### Cut list — do not build these

Bevy rendering · MMGIS self-host · MEDA PDS bundles · MSL RAD parsing · GB-scale GeoTIFFs ·
float32 WMS layers · draping thematic rasters on the 3D tileset · login · AI inference services ·
"anywhere on Mars" as a claim · rover *commanding* (tracking the real traverse is in) ·
step counters · 3 UI modes · Quest Link · other robotic systems (scout drone, follower robot — one
deck bullet as future work, no code) · invented vitals (heart rate, fatigue) · a CO₂ tank

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
labelled "modelled" in the UI. We never parse RAD from PDS. It is readout-only and never enters the
router (§6: ~70 µGy over an 8 h EVA, the same everywhere at walk scale).

### Resolution tiers

Gale and Jezero have metre-scale data. Everywhere else gets MOLA ~463 m and THEMIS ~100 m,
which **cannot** support obstacle avoidance for a walking human. Those sites display a
**"coarse data — not walk-scale"** badge. A missing tile (404) is the tier indicator.

### Views and legends

The astronaut switches views like the Google Maps layer button. A **view** is a preset of
`{layers on, opacity, basemap dimmed or off, legend}`. It is one state change on the layer panel, not a
mode: the person can still tweak any layer afterwards.

| View | What it shows |
|---|---|
| **Satellite** | Gale optical only |
| **Terrain** | MOLA colour relief + slope surface |
| **Thermal** | THEMIS thermal; thermal inertia if the P2 pick ships |
| **Hazard** | Slope-cost traversability + comms blackout + time-to-safety + crew reports + no-go mask over dimmed optical |
| **Science** | OMEGA/CRISM hydrous detections + target markers over optical |

- **Heatmap-only** is a "basemap off" toggle on any view, so a layer can be read on its own.
- **Every layer has a legend.** For our two derived rasters we choose the colour ramp, so the legend is exact
  (slope in degrees, cost in seconds, blackout in seconds). For remote layers the legend comes from the
  service's own metadata; if we cannot find one, label it "relative / service colour scale". No invented
  numbers on a legend.

---

## 5. Cost model — time-denominated

Every quantity is expressed in **seconds**, so hazards are directly comparable and the
resource budget shares one unit.

```
t(cell)      = step_len / (v0 · slope_penalty · roughness_penalty)
comms(cell)  = max(0, blackout_seconds_along_segment − 60) · k
cost         = t + comms
```

- **Hard mask (impassable):** slope above suit mobility limit · DEM roughness above threshold ·
  no-data tiles · crew-reported Avoid zones (§13) · walk-back time over the limit (§6).
  Radiation dose is not here: it cannot tell routes apart (§6). There is no rock-abundance layer in §4, and
  orbit cannot see rocks under ~1 m, so roughness is DEM-derived and flagged low-confidence (§12).
- **Soft cost:** the two terms above, with `a`, `b` exposed as a single **"risk tolerance" slider**.
  Crew-reported Slow zones multiply `t` (§13).
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

- **Tools are a payload, not a footnote.** `tool_kg` is a parameter. On foot the crew carries it and it
  raises metabolic cost and lowers pace (scaling `ASSUMED`). With a parked rover it waits at the cache and
  only a sampling kit goes to the target. In the rover profile the vehicle carries it. This is the
  quantified answer to "transport the crew *and their tools*".
- **The cabin is the safe haven.** Only a *pressurized* concept vehicle is modelled, and its reserve check
  uses cabin consumables. An unpressurized vehicle would need an Apollo-style walk-back check, which we do
  not build. Rover breakdown is not modelled; say so on the slide.
- **Comparison card contents:** one row per profile — feasible?, ETA, % budget, reserve at return,
  hand-carried payload — for the selected target, crew of two. Infeasible rows stay visible with the
  reason ("fails reserve: crew 2, O₂"); they are not hidden.
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

- **Three depleting consumables: O₂, cooling water, battery** — the same three Apollo walk-back planning used.
  Each is a % of design capacity (design point: 8 h EVA at 1000 BTU/h average metabolic rate). O₂ and water
  burn in proportion to metabolic rate; battery burns at a flat draw (proportionalities `ASSUMED`). The
  **limiting consumable** is named in the UI.
- **Metabolic rate** = f(speed, slope, load = suit mass + `tool_kg`, gravity 0.38 g). There is no accepted
  closed form. Use a SEXTANT-style speed-by-slope table plus a load multiplier, and label every coefficient
  `ASSUMED` (spike 6).
- **Vehicle variant** for the rover profile: vehicle speed, trafficability slope limit, power draw,
  cabin consumables. Separate coefficient block, same output format.
  Anchor: NASA DRA 5.0 "commuter" architecture fields small pressurized rovers carrying a crew of two,
  ~100 km total range before resupply (see spike 5). Cite that; label everything else `ASSUMED`.
- **Pairs — crew of two is the default planning unit.** Run the budget once per crew member; a route is
  feasible only if **every** member makes the reserve, and the pace is set by the slowest/most-constrained
  one. That is the *constraint* side (~20 lines). The brief says pairs let you "accomplish more science",
  so add the *benefit* side:
  - **Shared load:** `tool_kg` is split between the two, so each carries less.
  - **Shared work:** time-at-stop is divided between two (`task_min_per_stop`, parallel factor `ASSUMED`).
  - **Output:** *science stops completed inside the reserve*, solo vs pair, same route, same budget. It is a
    relative figure labelled "modelled", never an absolute science-return claim.
  - Solo appears only as the baseline in that comparison. "EVAs are done in pairs" is stated as a
    convention (`ASSUMED`) until we have a source for it.
- **20% reserve is a hard routing constraint** (for each crew member), not a dashboard number. If no route meets it,
  the app says so and offers the shortest route that does.

- **Walk-back constraint (new, core).** Real EVA planning limits how far crew can be from a safe haven if life
  support fails. Apollo computed it from oxygen, sublimator feedwater and battery, then recalculated it during
  the EVA from actual use. We do the same: a Dijkstra pass from the safe haven (hab, or the parked rover as
  refuge) over the **same cost grid** gives a **time-to-safety raster**. A route is feasible only if the
  walk-back time at every point is within `walkback_limit_s`. Default 60 min: NASA's Mars PLSS study sizes the
  backup for 1 h on 4–8 h EVAs; a 2026 Mars suit-mass study suggests as little as 30 min (~1.8 km at 3.5 km/h).
  The UI shows which one is in use. This is why foot reach is ~2 km, and why a parked rover as haven extends it.
  The raster is also a heatmap layer ("time to safety, minutes") with an exact legend.
- **Live tanks (simulated).** The route output carries a `timeline[]` with O₂ / water / battery % and walk-back
  margin at every step. A playback scrubber moves the astronaut along the route and the gauges follow. They
  are labelled "simulated" everywhere they appear.

### What we model, read out, and leave out

| Metric | Verdict | Basis |
|---|---|---|
| O₂ level | **Model** | Burn ∝ metabolic rate. NASA PLSS studies size O₂ and water as the depleting consumables. |
| Cooling water | **Model** | Same. Absolute Mars water use is uncertain, so % only, `ASSUMED`. |
| Battery | **Model** | Flat draw. xEMU batteries outlasted the 8 h design requirement in NASA chamber tests. |
| Walk-back time + margin | **Model** | Apollo practice; slope-dependent version in TU Munich's V-SUIT (ICES 2018). |
| Daylight remaining | **Model** | Geometry only: EVA must end before local sunset minus a margin (`ASSUMED`). Needs the P1 solar clock. |
| Radiation dose | **Readout only** | GCR ~0.21 mGy/day at Gale (RAD, Hassler 2014) is ~70 µGy over 8 h and uniform at walk scale. RAD saw three solar particle events in its first Martian year at several times the quiet dose; we cannot forecast those, so it is a standing note. RAD measures aboard the rover, so a suited crew's dose differs. |
| Ground / air temperature | **Readout only** | REMS record, historical. No threshold shown unless we find a sourced suit limit. |
| CO₂ scrubber tank | **Leave out** | Rapid-cycle amine swingbeds are regenerative, so CO₂ removal is not an EVA-duration-limiting consumable. |
| Heart rate, fatigue, vitals | **Leave out** | No validated route-level model found. Metabolic rate is the sourced proxy. |
| Wind, dust loading, soil strength | **Leave out** | No walk-scale data and no routing effect we can source. Soil and rock hazards enter through crew reports (§13). |
| Rock abundance | **Leave out as a layer** | HiRISE resolves boulders ≳1 m only, and §4 has no walk-scale rock layer. |

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
5. **Concept-vehicle parameters** — DRA 5.0 gives crew of two and ~100 km total range for the small
   pressurized rover (Munk et al., NTRS 20100017229; main report NASA/SP-2009-566). Find a source for speed,
   power draw and cabin consumables, or label them `ASSUMED`. Add DRA 5.0 to References either way. ~30 min.
6. **Resource-model sources** — I only read excerpts of these, so read the primaries before quoting a number:
   NASA Mars PLSS studies (NTRS 20260002884, 20260005204: 2/4/6/8 h EVAs, backup sized 0.5 h for a 2 h EVA and
   1 h for 4–8 h); Mars suit-mass study (ICES-2026-127, NTRS 20260005410: 1000 BTU/h average, 30-min walk-back
   suggestion); V-SUIT walk-back method (Olthoff, ICES 2018); Apollo 15 traverse-constraint paper (NASA ALSJ
   19790073512); metabolic models (Kluis et al. 2022; Brown et al. 2018 on walking cost at 0.38 g; SEXTANT /
   Marquez). Output: `docs/assumptions.md` rows, each with a URL or `ASSUMED`. All go in References. ~1 h.

---

## 8. Definition of done

- Loads cold from a public URL, logged out, on hotel Wi-Fi, no key, no setup.
- Demo route renders with all shipped layers and visible provenance chips.
- Route bends around a no-go zone and a long comms blackout; short dropouts are ignored.
- Survival panel shows reserve-at-return and refuses an infeasible route.
- The route card explains itself (cost breakdown, straight-line baseline, a note per detour) and shows its
  warnings plus the standing caveats (§12) on every route, feasible or not.
- **If P1 #8–10 shipped:** the time-to-safety raster and walk-back margin are shown; a crew report added on
  the route makes the planner bend around it and the Why panel cites that report.
- **If P1 #11–12 shipped:** the comparison card shows Foot / Foot + rover / Rover (concept) for the demo
  target; a route failing the reserve for *either* crew member is refused and names who; one of the 7 slides
  is that card. **If not:** the deck says profiles and crew are parameters of the router but not exposed,
  and claims nothing more.
- **VR HUD:** the public link opens in the Quest 3 browser and enters VR; the same link on a laptop with no
  headset shows the same scene with mouse-look; a Quest capture or screenshot is on a slide.
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
| 5 | **Route card:** ETA, consumables budget (O₂ / water / battery, per-step `timeline[]`), 20% reserve check, why-this-route basics (cost breakdown + straight-line baseline), warnings + standing caveats (§12) | Infeasible route is refused, not drawn; a feasible route shows its limiting consumable, why it detours, and at least the standing caveats |
| 6 | Comms LOS layer + blackout term in routing | Long blackout is avoided; 3 m dropout is ignored |
| 7 | **VR HUD (minimal)** — separate Three.js WebXR scene reading `route.json` | Public link enters VR in the Quest 3 browser and shows terrain patch, route, waypoints and floating consumables / ETA / walk-back / warnings panels; the same link works on a laptop without a headset |

**P0 architecture rule (no new P0 features):** write #4–#5 against a `MobilityProfile` argument and a
`crew: Member[]` array from the first commit. P0 ships Foot × 2 hardcoded; P1 #11–12 are then config and UI,
not a refactor. Retrofitting this after P0 is how the rover answer gets cut.

**P0 #7 is a parallel track, not a step after #6.** It needs the `route.json` contract, not the planner.
Freeze the schema first (~30 min, §11), hand-write a fixture `route.json`, and build the scene against it;
swap in the real export when #4–6 emit it. If one person is doing everything, #7 starts the moment #1–6
pass and goes ahead of all P1. Minimum scope is ~4 h (§11); the 360° panorama is a stretch inside it.

### P1 — only after all P0 green

| # | Feature | Cost | Note |
|---|---|---|---|
| 8 | **Time-to-safety raster + walk-back constraint** — Dijkstra from the haven over the same grid, Hazard-view layer, playback scrubber with live simulated tanks | 1.5 h | §6. Test: moving the haven changes the raster; a route point whose walk-back time exceeds the limit makes the route infeasible. |
| 9 | **Crew field reports** — tap to add Avoid / Slow zones, instant re-plan, GeoJSON export/import | 2.5 h | §13. Test: add a rock field on the route → the route bends around it and the Why panel cites the report. |
| 10 | **Why-this-route, full** — what-if variants shown as rejected dashed routes, along-route strip | 1.5 h | §12. The basic version is already in P0 #5. |
| 11 | **Mobility profile comparison** — Foot / Foot + rover cache / Rover (concept) for the selected target | 1.5 h | Same `planRoute()`, three parameter sets. Test: one target → three rows, rover row labelled "concept vehicle", infeasible rows kept with reason. |
| 12 | **Pair mode** — per-member budgets, shared `tool_kg`, science-stops count; partner shows live O₂/battery | 2 h | Replaces the old "simulated crew" row: the partner *is* the simulated crew. Test: make one member infeasible → route refused, member named. |
| 13 | **View selector** (Satellite / Terrain / Thermal / Hazard / Science) with a legend per layer | 1.5 h | §4. Test: each view toggles the right layers, shows a legend, and "basemap off" isolates the layer. |
| 14 | **Local solar time + daylight margin** — EVA start-time input, sunset warning | 1 h | From longitude + mission sol. Feeds the daylight warning in §12. |
| 15 | POV panorama viewer at waypoints | 2 h | Brief explicitly asks for this |
| 16 | Atmosphere sol slider (live MSL/REMS) | 1 h | Measured, never "forecast" |
| 17 | **Real peer broadcasting** via public MQTT-over-WebSocket broker + `?room=` | 2–3 h | **First P1 item to drop.** If shipped, the partner in #12 can be a real second client and crew reports sync to them. Random room UUID. Falls back to simulation. |

**Suggested cut line: after #14** (about 12 h of P1). #15–17 are bonus. The brief only says to *consider*
point-of-view images; it asks for safety and route planning first.

*Dropped: the 2D CSS HUD overlay. The VR scene's laptop preview is the HUD, and DOM panels cannot be reused inside VR anyway.*

### P2 — pick **one**, Sunday morning, only if P1 green

Thermal inertia proxy (20 min, cheapest; gives the Thermal view a quantitative layer, not just grayscale imagery) · precomputed terrain-classification raster ·
base-siting suitability score · area-of-interest search + save explored points ·
ion 3D walk mode (needs a working token).

*`tatharis n shi classification` from the brainstorm is undefined — get one line from the team
before it can be slotted anywhere.*

### P3 — stretch, or deck-only

Rover commanding mock. (VR HUD is no longer here: it is P0 #7.)

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

## 11. VR HUD — must ship

CesiumJS has **no WebXR support** (roadmap, no timeline). So:

- **Separate Three.js WebXR scene**, opened from a link in the **Quest 3 browser** — not Quest Link, which
  adds a PC, a cable and a PCVR runtime for no benefit. Static page; same public-link rules as everything else.
- **It must work without a headset.** Judges will open the link on a laptop. "Enter VR" appears only where
  `immersive-vr` is supported; otherwise the same scene runs with mouse-look. That laptop view is also the HUD
  demo for anyone without a Quest, which is why the 2D CSS HUD was dropped.
- **Consumes `route.json`.** Minimum fields: `profile`, `crew[]` (reserve per member), `path[]` as
  lon/lat/elevation, `waypoints[]`, `blackout[]` segments, `eta_s`, `timeline[]` (O₂ / water / battery % and walk-back margin per step),
  `warnings[]`, `reports[]`, and a local `terrain` height grid (a few
  hundred metres, cut from the DEM corridor). **Freeze this schema before anyone builds against it.**
- **Ships with a committed demo `route.json`.** "Open in VR" in the planner hands over the live route through
  same-origin storage and falls back to the committed one, so the VR scene never depends on a fetch at judge
  time.
- **Minimum scope (~4 h):** terrain patch, route line, waypoint markers, four floating panels (consumables,
  ETA, walk-back margin, warnings). **Stretch inside it:** 360° panorama at waypoints.
- **HUD panels are canvas textures on planes, not DOM.** DOM overlays do not carry into an immersive VR
  session, so the CSS HUD could never have been reused.
- **A third renderer over the same data**, which is what the `planRoute()` seam buys us. It never touches
  the Cesium app; the only shared thing is `route.json`. Add Three.js to References.

---

## 12. Explaining the route and declaring its limits

Trust is the product. The route card must answer *why this route* and *what is still risky*. No AI is
involved: every sentence is a template filled from planner output.

### Why this route

- **Cost breakdown:** a stacked bar of the route's seconds by term (flat travel, slope, roughness, comms, crew
  slowdowns), with the limiting consumable named.
- **Straight-line baseline**, always computed. "Straight line: 1.1 km, 14 min, but crosses 2 slope no-go cells and
  6 min of blackout. Chosen: 1.4 km, 19 min, crosses none."
- **Detour notes:** each place the route leaves the straight line gets one generated sentence. "Detour 180 m
  west: avoids 22° slope (suit limit 15°)."
- **Route coloured by dominant cost driver**, plus an along-route strip: elevation, slope, blackout, O₂ / water /
  battery and walk-back margin against distance. Hovering moves a marker on the map and in VR. It is the same
  strip as the consumables timeline (§6).
- **What-if variants (P1 #10):** the same `planRoute()` rerun with one constraint relaxed at a time (ignore comms,
  ignore crew reports, relax the slope limit). They appear only inside the Why panel, as dashed grey routes
  labelled REJECTED with the reason. They are never offered as routes: infeasible still means refused.
- **Code seam:** `planRoute()` also returns per-step cost components. `explain()` lives in its own file and
  imports no Cesium.

### Warnings — declared even when the route is feasible

A feasible route is not a safe route. Warnings are rule-based, graded INFO / CAUTION / WARNING, shown in the
route card, drawn on the map where they have a location (click to zoom), and exported in `route.json` so the
VR HUD shows them. Every threshold is `ASSUMED` and listed in `docs/assumptions.md`.

| Rule | Level | Example text |
|---|---|---|
| Reserve at return under 30% (but ≥ 20%) | CAUTION | "Reserve at return 24%: thin." |
| Limiting consumable | INFO | "Water limits this EVA, not O₂." |
| Walk-back margin under 15 min anywhere | CAUTION | "Walk-back margin is 9 min at waypoint 3." |
| Max slope within 20% of the suit limit | CAUTION | "3 segments steeper than 12° (limit 15°)." |
| Blackout remains on route (no alternative) | WARNING | "Blackout 4 min 10 s between waypoints 2 and 3." |
| Dropouts under the 60 s grace | INFO | "5 dropouts, 38 s total, within grace: listed, not penalised." |
| Ends within 45 min of sunset | CAUTION | "Return ends 30 min before sunset." |
| Route passes within 30 m of an unverified crew report | CAUTION | "Passes 20 m from crew report #2." |
| Pair: weakest member | INFO | "Crew B sets the pace." |
| Concept rover profile | INFO | "Concept vehicle: parameters assumed." |

**Standing caveats — shown on every route, not dismissible:**
- "Orbital imagery resolves boulders of about 1 m and up. Smaller rocks, loose sand and soft ground are not on
  this map." (HiRISE; Hood et al. 2022.)
- "Atmosphere and temperature are past measurements, not forecasts."
- "Solar particle events cannot be forecast here. Shelter procedure is not modelled."
- "Consumable levels are simulated from assumed coefficients."

---

## 13. Crew field reports — the astronaut updates the map

Orbit cannot see everything. HiRISE resolves boulders of roughly a metre and up; below that, and for soft
ground, only someone standing there knows. Apollo 17's orange glass at Shorty Crater was not visible in
remote-sensing data, and walk-back limits cut the time available there (NASA traverse-planning paper,
NTRS 20090036808). So the map is not read-only.

- **Add a report:** tap the map, drop a circle (radius slider, minimum one grid cell) or draw a polygon, pick a
  type (Rock field · Soft ground · Drop or crater edge · Obstacle · Science note) and an effect: **Avoid** (hard
  mask) or **Slow** (cost multiplier, `ASSUMED`). A Science note has no routing effect. Optional free-text note.
  Timestamp is sol + local solar time; author is Crew A or B. No accounts.
- **Re-plan immediately.** Reports are rasterised onto the grid and reach `planRoute()` through `costFn`, so the
  seam is unchanged. The Why panel cites them ("Detour avoids crew report #2: rock field").
- **Reports can only add risk.** They never lift a physics-based mask (slope, no-data). A wrong *Avoid* costs
  time; a wrong *clear* costs a person. Deleting your own report is allowed.
- **Visible as data, with provenance.** A "Crew reports" layer carries the same provenance chip as every other
  layer: source crew field report · resolution as entered · time sol N · "unverified by orbit".
- **Storage without a backend:** browser storage on the device plus GeoJSON export/import (a few KB). If P1 #17
  ships, reports sync to the partner; otherwise the partner imports the file.
- **Demo seed:** `public/reports/demo.geojson` ships 2–3 reports so the first load shows the feature working.
  They are labelled **SIMULATED crew report (demo)**: we never present invented rocks as NASA data. A "clear
  demo reports" button resets them.
- **VR:** reports travel in `route.json` (`reports[]`) and are drawn as markers in the VR scene.
