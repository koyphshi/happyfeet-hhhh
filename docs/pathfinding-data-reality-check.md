# Pathfinding data: reality check

## Verdict

**A* is straightforward to implement; a credible route is a data and model problem first.** The repository currently has no A* implementation, route grid, slope raster, relay/line-of-sight raster, route JSON, or mobility coefficients. The running viewer can query global MOLA elevation, but its finest currently configured grid is 32 pixels/degree (about 1.85 km per pixel at the equator). That is useful for regional context and spot readouts, not foot-scale routing.

A Gale-only demo route is attainable if we first prepare and validate a local elevation corridor. It must be presented as an **illustrative, assumption-based planner**, not a certified safe route. The plan's one-hour estimate for the DEM/slope work is optimistic until the data export and coordinate registration spikes are resolved.

## What exists, and what it can support

| Input | In the plan / source status | In this repository | Routing verdict |
|---|---|---|---|
| Global topography | MOLA MEGDR is a planet-wide gridded elevation product. The full MEGDR family includes 128 px/degree products (about 463 m/px at the equator). | `web/serve.mjs` reads 4, 16, and 32 px/degree files; the finest is about 1.85 km/px. It returns sampled heights, not a route-ready local grid. | **Not sufficient for foot routes.** Do not derive a human slope mask from these samples. |
| Gale topography | USGS lists a 1 m-posted Gale merged DEM with coverage across the crater and a 3.6 GB source GeoTIFF. It combines HiRISE, CTX, HRSC, and MOLA. Where stereo coverage is missing, the metadata says coarser source DEMs are substituted, so “1 m posting” does not mean uniform 1 m measurement quality. | Not loaded or sampled by the app. `PLAN.md` still lists `Gale_DEM_SMG_1m` export behavior as an unresolved spike. | **Best available base for a local demo**, after clipping a corridor, checking effective source coverage, and registering it. |
| Slope | The plan proposes deriving slope from the Gale DEM. | No slope derivation or raster exists. | **Derivable**, using a local metric grid and a documented neighborhood scale; threshold remains an assumption for suited humans. |
| Rocks / roughness | The plan acknowledges there is no walk-scale rock abundance layer and treats DEM roughness as low confidence. | No hazard classification or roughness grid exists. | **Major limit.** Elevation slope alone cannot identify sand, loose material, small rocks, or all obstacles. Do not call an A* path “safe.” |
| Thermal | Global THEMIS day-IR tiles are available; the plan's finer thermal-inertia option uses an ASU WMS proxy. | The app has layer plumbing for NASA Trek imagery, but no thermal cost surface. | **Readout/context only.** The plan does not define a supported path penalty from these image layers. |
| Spectral | Trek lists a CRISM/OMEGA hydrous-mineral detections service. | No route input or decoded values exist. | **Science-target context**, not a traversability cost. It can help choose a destination, not decide which cell is walkable. |
| Radiation | The plan says to show a modelled dose readout, not parse RAD or use dose in route cost. | No dose model or route term exists. | **Keep out of A*.** A spatially uniform walk-scale estimate cannot distinguish paths. |
| Communications | The plan proposes terrain line-of-sight to a fixed relay, with a grace interval. | No relay coordinates, LOS grid, or route cost exist. | **Possible approximation**, once relay position/antenna height and terrain are defined. Terrain LOS is not a radio-link or guaranteed-telemetry model. |
| Mobility / resources | `PLAN.md` defines a time-based cost and hard slope mask. | `docs/assumptions.md` has blank entries for speed, slope/roughness penalties, maximum suit slope, metabolic costs, and comms coefficient. | **Not yet calibrated.** Any route score, ETA, or feasibility result needs visible `ASSUMED` labels until those values have defensible sources. |

## Two data issues to resolve before routing

### 1. Coordinate convention can move the route by kilometres

The USGS Gale DEM metadata identifies its latitude as **planetocentric**. The current viewer's Mars ellipsoid coordinates use Cesium's geodetic/planetographic latitude convention, while the MOLA reader in `web/serve.mjs` indexes rows as if its input latitude were planetocentric. Trek services use Mars CRS EPSG:104905 (documented in the existing feasibility research as planetographic). These conventions cannot be mixed silently.

Using the Mars ellipsoid axes in this repository, the latitude-convention difference near Gale's ~5° latitude is about **0.06° (roughly 3 km)**; near Jezero's ~18° latitude it is about **0.2° (roughly 12 km)**. This is a geometric estimate, not a measured registration error, but it is already larger than the planned ~1.5 km Curiosity panorama cluster. Convert all inputs into one declared convention and check registration against known landmarks before routing.

### 2. DEM coverage is not uniform in quality

The USGS Gale merged product is a strong starting point, but its metadata explicitly says lower-resolution CTX, HRSC, and ultimately MOLA products fill areas without HiRISE stereo coverage. Before treating a corridor as walk-scale, inspect the source/quality coverage inside the exact corridor and mark fallback or missing cells. Resampling a coarse DEM to 5 m cells makes a finer grid; it does not create finer terrain information.

## What is attainable for an A* milestone

Once the data are prepared, a pure TypeScript A* module over a small local grid is a reasonable fit for this project. Use eight-connected cells, real metric edge lengths, a non-negative traversal-time cost, a conservative admissible distance heuristic, and a hard mask for no-data and chosen slope limit. Keep Cesium drawing and input handling outside the planner, consistent with the plan's pure `planRoute(grid, start, goal, costFn)` seam.

The first credible milestone should be limited to:

1. A single Gale corridor clipped from the USGS DEM, with coordinate system and source-coverage mask recorded.
2. Derived slope and local-roughness grids at stated analysis scales, plus one explicit assumed suit-slope threshold.
3. A terrain-hazard / surface-class layer, starting with reviewed map annotations and any suitable Gale rock-abundance product; keep its coarser features and confidence visible.
4. A* from a user-selected start to target, with route length, travel-time estimate, and a straight-line comparison.
5. A test no-go area so a detour can be demonstrated independently of claims about real rocks.
6. A clear notice that the route omits unobserved small hazards, uncertain soil strength, and validated human mobility.

Do **not** make route feasibility depend on unimplemented oxygen, battery, walk-back, or radio-link models in the first terrain-only A* slice. Terrain classes and hazard annotations are in scope, but they must be explicit inputs with visible provenance and confidence—not a claim that orbital imagery automatically reveals walkability. The A* function is not the blocker; trustworthy inputs and scope control are.

## Terrain-only layers worth considering

The route scope is limited to physical surface shape and visible terrain hazards. Thermal, mineral,
weather, radiation, communications, and life-support layers do not affect the first A* cost model.

| Layer | Source / construction | A* role | Limitation |
|---|---|---|---|
| Elevation | Numeric Gale DEM; prefer HiRISE stereo source cells, preserve source-quality provenance | Base values for slope and roughness | The merged 1 m-posted product has lower-resolution CTX, HRSC, and MOLA fill areas. Do not imply uniform 1 m detail. |
| Slope | Derived from elevation at an explicit neighborhood scale | Hard mask above an assumed suit limit; optionally a smooth traversal penalty below it | Smoothing and cell size change measured maxima; a rover limit cannot be copied as a human suit limit. |
| Local roughness / relief | Derived from elevation (e.g. local range or standard deviation over a stated window) | Soft penalty for broken, uneven, or highly variable ground | Scale-dependent and correlated with slope; avoid counting the same ridge twice. |
| Ridges, scarps, crater rims, gullies, steep breaks | Derived from DEM/slope, with image review or manually mapped boundaries | Hard obstacles when confidently identified; otherwise a softer caution cost | Narrow features can be smoothed out or absent where source DEM coverage is coarse. |
| Rock abundance | Existing Gale rock-density maps where obtainable; HiRISE imagery for human review | Broad risk penalty; hand-mapped conspicuous blocks may be explicit obstacles | The Gale GIS report describes rock maps in 150 m and 450 m cells: useful regional statistics, not individual step-scale boulders. |
| Surface / landform class | Initially reviewable human annotations on imagery; automated classification only if validated | Relative cost for mapped bedrock, loose-looking surface, dunes/ripples, boxwork ridges/hollows, etc. | Orbital texture does not establish soil strength or distinguish all safe smooth regolith from hazardous sand. Keep class confidence and penalties explicit. |
| Data-quality / unknown mask | Derived from DEM provenance, effective source scale, no-data, and registration checks | Exclude unsupported cells or clearly label them unavailable | Essential guardrail, even though it describes our knowledge of the terrain rather than the terrain itself. |

A USGS/JPL Gale GIS report documents a useful precedent for combining HRSC, CTX, and HiRISE
imagery/DEMs with derived slope, rock-abundance, and traverse-cost products. That confirms these
layer types are realistic for Gale; it does not mean those products are already loaded here or that
rover-specific costs are valid for human walking. See the [USGS Gale GIS report](https://pubs.usgs.gov/of/2014/1056/pdf/ofr2014-1056.pdf).

All rasters must be aligned to one declared grid and coordinate convention. A* should consume a
transparent hard mask plus per-cell terrain costs, with each cost contribution inspectable. Do not
blindly add every layer: slope, roughness, and a terrain class can all be describing the same ridge.
Use test obstacles to verify detours, but label them as fixtures rather than real Mars observations.

## Acquisition and processing pipeline

1. **Acquire a small numeric DEM first.** Try an `exportImage` request to Trek's Gale DEM ImageServer
   for only the candidate route corridor, requesting TIFF and the source coordinate reference. Inspect
   service metadata and the returned file: it must contain numeric elevation values (not a rendered
   color image), a known vertical unit, a meaningful no-data value, bounds, and a spatial reference.
   Check whether pixel-level source-resolution/provenance is supplied; if not, that needs a separate
   coverage layer. If the service export is rendered or loses the numeric fields, use the official USGS
   [3.6 GB GeoTIFF](https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif)
   as source and crop it locally. Do not download the full file until the small export path is tested.
2. **Audit and register it.** Read the raster header and metadata before analysis: dimensions, pixel
   spacing, data type, vertical units, no-data value, bounds, projection, and latitude convention.
   Convert rover/map coordinates and the DEM into one declared Mars coordinate system. Compare at
   least several known landmarks or rover waypoints against the HiRISE mosaic; record any residual
   offset. Track the DEM's effective source quality, since its 1 m grid includes coarser gap fills.
   If there is no pixel-level source map, use source-footprint coverage if available and mark unknown
   areas honestly; a uniform 1 m quality mask cannot be assumed.
3. **Crop and create a metric analysis grid.** Clip a bounded corridor around a selected start and
   goal, then transform it to a local Mars projection whose horizontal units are metres. Choose the
   analysis cell size only after inspecting the native-source mask; 5 m is a candidate, not a promise.
   Aggregate finer cells where useful, but do not upsample coarse gap fills and call them walk-scale.
4. **Derive continuous terrain layers.** From the aligned elevation grid, calculate slope in degrees
   and one or more local-roughness metrics (for example, elevation range or residual from a fitted
   local plane). Record each neighborhood size in metres; a 5 m roughness value and a 25 m roughness
   value describe different terrain scales. Export numerical rasters, not only colored PNGs.
5. **Build obstacle and class layers.** First locate whether the historic 150 m / 450 m Gale rock
   abundance products can be obtained in GIS form. If available, align them as coarse risk context.
   For individually visible hazards, annotate reviewed HiRISE image features as polygons/lines (for
   example a large rock, scarp, crater rim, or dune boundary) and store them in a small GeoJSON with
   source image, author/date, class, and confidence. Add visible surface classes the same way. Do not
   silently turn color/texture into claims about soil mechanics.
6. **Compose the planner input.** Keep separate numeric arrays for elevation, slope, roughness, class
   cost, rock context, hard obstacles, and source confidence. Align all arrays to the same dimensions,
   transform, and cell origin. Continuous values can be aggregated/interpolated deliberately;
   categorical classes and masks require nearest-cell semantics. A no-data or unsupported cell stays
   identifiable, never converted into a plausible numeric elevation.
7. **Render and route from the same grid.** Generate visual overlays/legends from the processed data,
   but feed the underlying numeric arrays and masks to A*. Keep the source GeoTIFF out of the web bundle;
   ship only the compact corridor arrays plus a metadata sidecar (CRS, transform, units, no-data,
   resolution/source-quality mask, processing parameters, and source URLs). This makes the route repeatable
   without making an RGB image the hidden source of truth.

This pipeline has one early go/no-go: if the Trek export cannot preserve numerical elevations and
usable spatial metadata, the USGS file remains a valid fallback but requires a one-time large download
and local GIS processing. Source-quality coverage may still need to be built separately. The existing
app's global MOLA height service is not a substitute for this local corridor DEM.

## Source checks

- The [USGS Gale merged DEM record](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m) documents 1 m pixel posting, the mixed HiRISE/CTX/HRSC/MOLA source hierarchy, 3.6 GB file size, coverage, and planetocentric latitude.
- The [NASA PDS MOLA MEGDR record](https://pds.nasa.gov/ds-view/pds/viewProfile.jsp?dsid=MGS-M-MOLA-5-MEGDR-L3-V1.0) describes global gridded altimetry and its available pixel-per-degree resolutions.
- [NASA Mars Trek's API documentation](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars) documents the Mars tile service; the repository's feasibility note records the tested Trek products and EPSG:104905 service CRS.
- NASA's [Curiosity location map](https://science.nasa.gov/mission/msl-curiosity/location-map/) explains that high-resolution DEMs support rover drivers in judging hill steepness. It does not establish a suited-human slope threshold.
- NASA's [Perseverance AutoNav description](https://science.nasa.gov/resource/how-perseverance-drives-on-mars/) describes making 3D maps, identifying hazards, and planning around obstacles from onboard sensing. This is a useful contrast: orbital DEM slope alone is not the full operational hazard picture.

## Repository audit

Checked against `PLAN.md`, `PLAN-integrity.md`, `RESEARCH-mars-cesium-feasibility.md`, `docs/assumptions.md`, `web/index.html`, and `web/serve.mjs` on 2026-11-14. The service/catalog names in the research note and plan are leads, not proof that their products are already ingested by this app. No route planner or route data files are currently present.
