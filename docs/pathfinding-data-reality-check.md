# A* pathfinding: reality check and implementation plan

## Verdict

**A* is feasible. Terrain data and honest limits are the main work.** There is currently no route
planner, route grid, slope/roughness layer, obstacle mask, or route output in the app. The existing
global MOLA height service reaches about 1.85 km per pixel at its finest configured level, so it is
useful for regional context but not for foot-scale pathfinding.

A local Gale route is attainable as an **illustrative terrain-based estimate**. It must not be
presented as a safe human route: orbital data cannot resolve every small rock, loose-soil condition,
or other local hazard, and suit-mobility thresholds have not been validated.

## What exists now

| Item | Current state | What it means for A* |
|---|---|---|
| App | Vanilla JavaScript + Cesium; no Vite/TypeScript build. | A pure JavaScript planner module fits the current app. |
| Global elevation | `web/serve.mjs` serves MOLA at 4, 16, and 32 pixels/degree; the finest is about 1.85 km/pixel near Gale. | Not suitable for foot-scale routes. |
| Gale DEM | NASA Trek's `Gale_DEM_SMG_1m` ImageServer is available. A small numeric export was verified (details below). | Strong starting point for a local terrain grid. It is not yet integrated into the app. |
| Terrain layers | No route slope, roughness, surface-class, rock, or obstacle grids exist. | Need to derive or annotate them before they can affect route choice. |
| Planner and inputs | No A*, start/goal routing UI, route JSON, relay, or filled-in mobility parameters. | The route feature has not been started in code. |

## Terrain-only scope

The first route cost uses physical surface shape and visible terrain hazards. Thermal, spectral,
weather, radiation, communications, and life-support inputs are out of scope for this A* feature.

| Input layer | How we get it | How A* can use it | Important limit |
|---|---|---|---|
| Elevation | Numeric Gale DEM from NASA Trek; USGS GeoTIFF is the fallback. | Base surface from which slope and local relief are derived. | The USGS 1 m-posted mosaic contains coarser CTX, HRSC, and MOLA fill areas. Grid spacing does not guarantee uniform 1 m terrain detail. |
| Slope | Derived from elevation at a stated analysis scale. | Hard mask above a clearly labeled, assumed suit limit; optionally a graded cost below it. | Rover tilt limits do not establish human suit limits. Smoothing and cell size affect measured slopes. |
| Local roughness / relief | Derived from elevation over stated neighborhoods, such as local range or deviation from a fitted plane. | Relative penalty for uneven or broken ground. | Scale-dependent and correlated with slope; avoid double-counting a ridge. |
| Terrain breaks | DEM/slope analysis plus image review: scarps, crater rims, gullies, steep ridges. | Block confidently mapped impassable breaks; otherwise apply a caution cost. | Narrow features may be absent from coarse source areas or smoothed by resampling. |
| Rocks and boulder abundance | Try to obtain the historic Gale rock-abundance products; inspect HiRISE imagery for local annotations. | Coarse rock-risk cost; explicit polygons for conspicuous obstacles. | The Gale GIS report describes rock-abundance maps at 150 m and 450 m cells. These are regional statistics, not a map of each walk-scale boulder. Product availability in GIS form is not yet confirmed. |
| Surface / landform class | Initially annotate reviewed imagery: for example, bedrock, dune/ripple, loose-looking material, boxwork ridge or hollow. | Relative cost with a recorded class and confidence. | Orbital appearance alone does not determine soil strength or actual walkability. Automated classification needs validation. |
| Data quality / unknown mask | Build from no-data, source footprints/resolution, and registration checks where available. | Keep unsupported cells unavailable or explicitly uncertain. | Do not imply per-cell quality if the source only provides whole-product metadata. |

The [USGS/JPL Gale GIS report](https://pubs.usgs.gov/of/2014/1056/pdf/ofr2014-1056.pdf) documents
multi-resolution HRSC, CTX, and HiRISE imagery/DEMs plus derived slope, rock-abundance, and traverse
cost products. This confirms those layer types have been made for Gale; it does not mean they are
loaded into this app or that rover-specific costs apply to a human walking route.

## DEM acquisition: verified result

The NASA Trek service metadata at
[`Gale_DEM_SMG_1m/ImageServer`](https://trek.nasa.gov/mars/trekarcgis/rest/services/Gale_DEM_SMG_1m/ImageServer?f=json)
reports one F32 band, Mars CRS 104905, and approximately 1 m source pixel spacing.

A read-only `exportImage` request was made for a small area near the Curiosity panorama cluster:

```text
.../ImageServer/exportImage
  ?bbox=137.38,-4.81,137.39,-4.80
  &bboxSR=104905&imageSR=104905
  &size=512,512&format=tiff&pixelType=F32&f=image
```

The response was a 512×512, 1.1 MB, little-endian Float32 GeoTIFF. Pillow decoded all 262,144
samples as finite numbers, ranging from approximately −3641 to −3483 m. This confirms we can
request numeric corridor-sized elevation data; we do **not** need to begin with the full 3.6 GB
[USGS GeoTIFF](https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif).

The sample TIFF did not include an explicit GDAL no-data tag. Before using a route corridor, check
how the service represents gaps and query the imagery service's source coverage. If source quality
is not provided cell-by-cell, mark it unknown or derive a separate source-footprint mask; do not
assume the entire 1 m-posted mosaic has uniform 1 m detail.

## Processing: Python, once per data build

The terrain preparation is offline preprocessing. Python does **not** run for every A* request.

1. **Export the corridor.** A script calls `exportImage` for the selected Gale bounds and records
   the exact request, source URL, date, dimensions, and response metadata. Use the full USGS GeoTIFF
   only if the image service cannot supply a valid numeric corridor.
2. **Inspect and register.** Read raster dimensions, type, units, no-data, bounds, and CRS. Convert
   waypoint/map coordinates and terrain into one declared Mars coordinate convention. Check
   alignment against the HiRISE image and known locations before routing.
3. **Clip and make a metric analysis grid.** Crop to the chosen start/goal region. Select cell size
   after inspecting source coverage; 5 m is a candidate, not a pre-decided resolution. Aggregate
   fine terrain if useful, but never upsample a coarse fill and label it walk-scale.
4. **Derive slope and roughness.** Use GDAL/Rasterio and NumPy/SciPy on the aligned numeric DEM.
   Record the neighborhood sizes and processing parameters in metres. Keep each output numeric.
5. **Annotate obstacles/classes.** Look for the published Gale rock maps. If usable GIS files are not
   available, review the HiRISE mosaic and draw hazard/class polygons in QGIS or as GeoJSON. Record
   the image/source, class, and confidence for each annotation.
6. **Align and package.** Store separate elevation, slope, roughness, terrain-class, obstacle-mask,
   and data-quality arrays on one grid. Categorical classes and masks use nearest-cell semantics;
   numeric elevation resampling is chosen deliberately. Write a metadata sidecar with CRS, grid
   transform, units, no-data handling, source, and processing parameters. Keep colored map overlays
   separate from the numeric files used by the planner.

### Tools actually present here

This workspace has Python, NumPy, Pillow, and libtiff. It does **not** have `gdalinfo`/`gdalwarp`,
Rasterio, PyProj, SciPy, Shapely, or QGIS. Pillow was enough to inspect the exported sample, but it
is not a substitute for CRS-aware raster processing. The preprocessing environment should be a
Python virtual environment with Rasterio/GDAL, PyProj, NumPy, and SciPy; QGIS is optional for visual
annotation. These dependencies have not been installed yet.

## Runtime: JavaScript, once per route change

The app loads the prepared numeric grids into typed arrays once. A pure JavaScript A* module then
runs whenever the user changes the start, goal, terrain-cost settings, or obstacle mask. It combines:

- a hard mask for no-data/unsupported cells, mapped hard obstacles, and the assumed slope limit;
- visible per-cell costs for slope, roughness, rock context, and selected terrain classes;
- route distance and an estimated travel time from an explicitly assumed walking speed.

Changing a route does not re-download the DEM or recompute slope. If the source DEM, processing
parameters, or annotations change, rerun Python preprocessing, regenerate the arrays, and reload
them. This fits the current vanilla-JavaScript Cesium app; it does not require introducing Vite or
TypeScript.

## First implementation milestone and limits

1. Export and validate a bounded numeric DEM around a selected Gale start/target.
2. Resolve coordinate registration and no-data/source-quality handling.
3. Generate elevation, slope, roughness, and quality arrays; add a small, reviewed obstacle/class
   layer where the imagery supports it.
4. Implement A* over those arrays, using a test obstacle to prove detouring. Clearly label the test
   obstacle as a fixture, not an observed Mars hazard.
5. Draw the route and show distance, assumed travel time, and the terrain-cost contributions.

The output means “lowest-cost path through these supplied layers and assumptions,” not “safe path.”
Small rocks, uncertain soil strength, and validated human mobility remain unresolved.

## Sources and repository audit

- [USGS Mars MSL Gale Merged DEM 1 m](https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m): source mixture, coverage gaps, posting, coordinate convention, and file size.
- [NASA Trek Gale DEM ImageServer metadata](https://trek.nasa.gov/mars/trekarcgis/rest/services/Gale_DEM_SMG_1m/ImageServer?f=json): F32 band, spatial reference, and service extent.
- [NASA PDS MOLA MEGDR](https://pds.nasa.gov/ds-view/pds/viewProfile.jsp?dsid=MGS-M-MOLA-5-MEGDR-L3-V1.0): global topographic grid and planetocentric coordinate definition.
- [USGS/JPL Gale GIS report](https://pubs.usgs.gov/of/2014/1056/pdf/ofr2014-1056.pdf): multi-resolution terrain, slope, rock-abundance, and traverse-cost products.
- [NASA Perseverance AutoNav overview](https://science.nasa.gov/resource/how-perseverance-drives-on-mars/): example of local 3D mapping and obstacle sensing that orbital layers do not provide.

Repository review: `PLAN.md`, `PLAN-integrity.md`, `RESEARCH-mars-cesium-feasibility.md`,
`docs/assumptions.md`, `web/index.html`, and `web/serve.mjs`. Checked 2026-11-14. No A* planner or
route data is present yet. The exported sample is in `/tmp/gale-dem-probe.tif`; it is a probe, not
an app asset.
