# Mars "Google Earth" — Architecture Feasibility (verified Nov 14, 2026)

Every claim below was checked against a live endpoint or official page on 2026-11-14. Two things I
could **not** verify (no Cesium ion token, no browser here) and which you should test yourself in
the first 30 minutes: (a) that Cesium Mars streams with your ion account, and (b) that the Trek
tiles visually land on the correct spot given the planetographic/planetocentric question in §2.

## Verdict summary

| # | Area | Verdict |
|---|------|---------|
| 1 | CesiumJS Mars (ellipsoid + imagery + terrain) | **USABLE NOW** |
| 2 | Mars Trek WMTS tiles | **USABLE NOW** (CORS `*`, no key, no signup) |
| 3 | MMGIS as a foundation | **NEEDS PREP** (works, but 36h is tight; better as reference) |
| 4 | Data layers (Jezero/Gale) | Mixed — of 16 rows: **8 READY**, 7 PREP, 1 NO |
| 5 | Existing Mars-in-Cesium demos | **USABLE NOW** (official Sandcastle is the canonical one) |
| 6 | Bevy 0.20 + geospatial | **NOT REALISTIC** |

**Bottom line: build it in CesiumJS.** Cesium has first-class Mars support, and NASA already
publishes CORS-open Mars tiles at exactly the tiling scheme Cesium expects. The Bevy path has no
Mars story at all (its 3D Tiles loader hardcodes the WGS84 Earth radius).

---

## 1. CesiumJS Mars support — **USABLE NOW**

**Current version: CesiumJS 1.147** (docs reference `1.147` in source links).

### Ellipsoid
`Cesium.Ellipsoid.MARS` is a real, current, documented constant:

```js
// verified in the shipped bundle: cesium.com/downloads/cesiumjs/releases/1.147/Build/CesiumUnminified/Cesium.js
Cesium.Ellipsoid.MARS = Object.freeze(new Ellipsoid(3396190, 3396190, 3376200));
```

That is the **IAU 2000 biaxial ellipsoid** (a = 3 396 190 m, b = 3 376 200 m) — *not* a sphere,
despite the docs' loose "mean radii" wording.
- https://cesium.com/learn/cesiumjs/ref-doc/Ellipsoid.html
- CRS identity: https://epsg.io/104905 → `GCS_Mars_2000`, spheroid 3 396 190, 1/f = 169.894

### What is actually required
```js
Cesium.Ellipsoid.default = Cesium.Ellipsoid.MARS;

const viewer = new Cesium.Viewer("cesiumContainer", {
  globe: new Cesium.Globe(Cesium.Ellipsoid.MARS),
  skyAtmosphere: new Cesium.SkyAtmosphere(Cesium.Ellipsoid.MARS),
  baseLayerPicker: false,
  geocoder: false,
  terrainProvider: false,      // or a Mars terrain provider
});
```
Optional but high-impact: the official demo retunes the atmosphere for Mars
(`atmosphereMieCoefficient`, `atmosphereRayleighScaleHeight = 9000`,
`atmosphereMieScaleHeight = 2700`) and enables bloom/HDR. That is what makes it *look* like Mars
instead of a grey ball.

**Canonical source** (this is the real thing, 20 KB, MIT-licensed, copy-pasteable):
- https://raw.githubusercontent.com/CesiumGS/cesium/refs/pull/12828/head/Apps/Sandcastle/gallery/Mars.html
- PR that added it: https://github.com/CesiumGS/cesium/pull/12828
- Ships with `Apps/SampleData/Mars.czml`, `MarsPointsOfInterest.geojson`, and
  Curiosity/Perseverance/Ingenuity `.glb` models — a ready-made POI + rover-path dataset.

### Cesium ion DOES host Mars
**Cesium Mars, ion asset ID `3644333`**, launched Sept 3 2025:
- https://cesium.com/platform/cesium-ion/content/cesium-mars
- https://cesium.com/blog/2025/09/03/lift-off-to-cesium-mars

Asset specs (from the official page):

| Coverage | Resolution |
|---|---|
| Global imagery (Viking Colorized Mosaic 232m) | 232 m |
| Global terrain (MOLA + HRSC Blended DEM 200) | 200 m |
| **Jezero crater imagery (CTX ortho)** | **6 m** |
| **Jezero crater terrain (M2020 TRN CTX DTM)** | **20 m** |
| **Gale crater imagery (MSL Gale Merged Orthophoto)** | **25 cm** |
| **Gale crater terrain (MSL Gale Merged DEM)** | **1 m** |

```js
const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(3644333);
viewer.scene.primitives.add(tileset);
```

**Critical architectural caveat:** Cesium Mars is a *global 3D Tiles mesh*, and the official sample
sets `globe: false` / `viewer.scene.globe.show = false`. Cesium `ImageryLayer`s drape on the
**Globe**, not on a 3D Tiles mesh. So **you cannot stack your thematic rasters on top of the ion
tileset.** Design two view modes:
1. **Map mode** — Mars ellipsoid globe + `ImageryLayer`s (this is where the "layered hyperlocal
   map" lives; all sources below are CORS-clean).
2. **Walk mode** — ion tileset at Jezero/Gale + polyline route + POI billboards + first-person camera.

**Licensing:** Cesium Mars is listed under "Cesium Global 3D Content" in the ion ToS
(https://cesium.com/legal/cesium-global-3d-content-tos/). Requires an ion account + access token.
The free **Community tier** is for "personal, exploratory, and unfunded educational use"
(https://cesium.com/blog/2018/05/01/get-your-cesium-ion-community-account) — an unfunded NASA
hackathon project fits, but read the ToS. Attribution to NASA + USGS Astrogeology + Cesium is
required: https://cesium.com/learn/ion/content-usage-and-attribution-guide

### Terrain (quantized-mesh) for Mars
There is **no public Mars quantized-mesh terrain service**. Options, in order of effort:
- Use the ion tileset (terrain already baked) — zero effort.
- `Cesium.CustomHeightmapTerrainProvider` fed from a small pre-sampled MOLA/HRSC heightmap — ~2–4 h.
- `ctb-quantized-mesh` Docker from `Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif` — 4–8 h, risky.
  https://github.com/geo-data/cesium-terrain-builder

---

## 2. Mars Trek — **USABLE NOW**

Trek is **Dojo + OpenLayers (2D) + Cesium (3D)** — its Dojo package list literally includes a
`cesium` package, and its config carries `ellipsoidRadius: 3390000`, `control3D`, and CRS
`urn:ogc:def:crs:EPSG::104905`. It is a *sibling* of what you're building.

### The tile API is documented and open
- Index: https://trek.nasa.gov/tiles/ → redirects to https://trek.nasa.gov/tiles/apidoc
- Per-dataset GetCapabilities: `https://trek.nasa.gov/tiles/Mars/EQ/{dataset}/1.0.0/WMTSCapabilities.xml`

**URL template** (verified live):
```
https://trek.nasa.gov/tiles/Mars/EQ/{dataset}/1.0.0/default/default028mm/{z}/{y}/{x}.{ext}
```
From the GetCapabilities for `Mars_MGS_MOLA_ClrShade_merge_global_463m`:

- CRS: `urn:ogc:def:crs:EPSG::104905` (Mars 2000, ellipsoidal — **matches `Cesium.Ellipsoid.MARS`**)
- TileMatrixSet `default028mm`: 256×256 px, **2×1 tiles at level 0**, TopLeftCorner `-180 90`
- So: `matrixWidth = 2^(z+1)`, `matrixHeight = 2^z`

This is *exactly* Cesium's `GeographicTilingScheme` with `numberOfLevelZeroTilesX: 2`. No reprojection,
no gdal, no proxy:

```js
const mola = new Cesium.UrlTemplateImageryProvider({
  url: "https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg",
  tilingScheme: new Cesium.GeographicTilingScheme({
    numberOfLevelZeroTilesX: 2, numberOfLevelZeroTilesY: 1,
    ellipsoid: Cesium.Ellipsoid.MARS,
  }),
  rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
  maximumLevel: 7,
});
```

**CORS: `Access-Control-Allow-Origin: *`** on every tile I tested (verified with `Origin:` header).
No API key. No rate-limit headers observed.

### Verified working Mars datasets (probed at Jezero, 77.45°E 18.44°N)

| Dataset path | Ext | Max zoom | Note |
|---|---|---|---|
| `Mars_Viking_MDIM21_ClrMosaic_global_232m` | jpg | 7 | colour global basemap |
| `Mars_MGS_MOLA_ClrShade_merge_global_463m` | jpg | 7 | colourised shaded relief |
| `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018` | png | 9 | 100 m IR day mosaic |

Sanity check I ran: at z1, row 0 is blue/teal (northern lowlands) and row 1 is orange (southern
highlands) → **TileRow 0 = north**, which matches Cesium's `{y}` convention. Good.

**Max zoom at Jezero: z7 for Viking/MOLA-shade, z9 for THEMIS (~163 m/px).** Trek's global WMTS is
*regional context*, not a walking-scale basemap. For the route you need the high-res ArcGIS layers
below.

### The real prize: open ArcGIS REST services
Trek exposes its whole catalogue:
- https://trek.nasa.gov/mars/trekarcgis/rest/services?f=json (76 services, **open, CORS-enabled**)

Confirmed CORS (`Access-Control-Allow-Origin: <your origin>`) on both `exportImage` and `query`.

High-value layers for this challenge:

| Service | Type | What it is |
|---|---|---|
| `Perseverance_Traverse_Path` | MapServer | **Real Perseverance traverse**, 332 segments, sols, 20 720 pts |
| `mars2020` / `mars2020_waypoints` | MapServer | M2020 traverse + waypoints |
| `curiosity_path` / `curiosity_waypoints` | MapServer | MSL traverse |
| `curiosity_hirise_mosaic` | ImageServer | **Gale HiRISE ortho, 0.25 m/px**, 137.12–137.73°E, 4.93–4.25°S |
| `Gale_DEM_SMG_1m` | ImageServer | Gale DEM 1 m/px |
| `Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp` | ImageServer | 200 m global colour+shade |
| `Hydrous_Mineral_Detections_OMEGA_CRISM_clon0` | MapServer | **CRISM + OMEGA hydrous mineral detections** |
| `Chloride_Salt_bearing_Material_THEMIS_clon0` | MapServer | THEMIS chloride/salt |
| `Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw` | ImageServer | 200 m global DEM |

**Killer trick:** ArcGIS ImageServers have no `/tile/` endpoint (verified 404), but Cesium's
`UrlTemplateImageryProvider` supports `{westDegrees}`, `{southDegrees}`, `{eastDegrees}`,
`{northDegrees}` (confirmed in the 1.147 ref docs). So you can turn *any* ImageServer into a live
Cesium layer with no preprocessing:

```js
new Cesium.UrlTemplateImageryProvider({
  url: "https://trek.nasa.gov/mars/trekarcgis/rest/services/curiosity_hirise_mosaic/ImageServer/exportImage" +
       "?bbox={westDegrees},{southDegrees},{eastDegrees},{northDegrees}" +
       "&bboxSR=104905&imageSR=104905&size=256,256&format=jpg&f=image",
  tilingScheme: /* Mars GeographicTilingScheme as above */,
  rectangle: Cesium.Rectangle.fromDegrees(137.12, -4.93, 137.73, -4.25),
});
```
This gives you **25 cm Gale imagery with zero downloads.** (Verified: a 1024×1024 JPEG at
`bbox=137.3,-4.8,137.5,-4.6` returns 202 KB of real imagery.)

**Route as data, not pixels:** the traverse is queryable as GeoJSON, CORS-open:
```
https://trek.nasa.gov/mars/trekarcgis/rest/services/Perseverance_Traverse_Path/MapServer/0/query?where=1%3D1&outFields=*&f=geojson
```
→ 1.27 MB, 332 features, props `FID, sol, fromRMC, toRMC, length, SCLK_START, SCLK_END`.
Extent: lon 77.304–77.463, lat 18.427–18.500. **This is your demo route, free.**

Note: `resultRecordCount`/pagination is rejected ("Pagination is not supported") — request the whole
layer.

### Licensing / attribution
Trek is NASA/JPL-Caltech, funded by NASA. Each dataset has a `metadata/fgdc` record:
`https://trek.nasa.gov/mars/TrekWS/rest/cat/metadata/fgdc/html?label={productLabel}`
Credit the instrument team + NASA/JPL/USGS Astrogeology. Underlying data is mostly public-domain
NASA, but **MOLA/HRSC blend and HiRISE mosaics are "NASA and the USGS Astrogeology Science Center"**
— that exact phrasing is what Cesium itself uses. No API key, no click-through.

### Gotcha worth 20 minutes
Trek declares `EPSG:104905` = **ellipsoidal (planetographic)** latitude. The ASU/JMARS WMS (below)
is a plain degree grid that may be **planetocentric**. At 18°N the planetographic↔planetocentric
difference is ≈0.2° ≈ **12 km on the ground** — bigger than your whole route. Before you stack a
JMARS layer on a Trek layer, register them on a known landmark (Jezero's western delta) and nudge
if needed.

---

## 3. MMGIS — **NEEDS PREP**

Repo: https://github.com/NASA-AMMOS/MMGIS — **Apache 2.0**. Latest release **v5.2.24 (2026-08-03)**.
Docs: https://nasa-ammos.github.io/MMGIS/

### What it is
JPL/AMMOS's actual mission-ops GIS. The README's mission list is literally "MSL Curiosity Rover ·
InSight · Mars 2020 Perseverance Rover · Mars Helicopter (Ingenuity)". This is the software the
Mars 2020 team uses. It is not a toy.

### Mars support: yes, first-class
- **2D/3D**: Leaflet 2D + **Cesium 3D globe**, synchronised.
- **Planetary projections**: ships TileMatrixSets for every body, including
  `adjacent-servers/resources/tilematrixsets/planetcantile_v4/MarsGeographicOcentric.json`.
  I read that file: level 0 = 2×1 tiles, `cellSize 0.703125`, origin `[-180, 90]` — **the same tile
  grid as Trek WMTS** (Trek declares the ellipsoidal CRS 104905, MMGIS's default here is the
  ocentric sphere; the grid matches, the datum is a setting to double-check).
- Docs: https://nasa-ammos.github.io/MMGIS/configure/projections/planetcantile
- Mission configs for Mars already exist: `Missions/spice-kernels-conf.example.mars2020.json`,
  `...msl.json`.

### Out of the box — this is a near-perfect match to the challenge brief
Draw (multi-user), Measure (distance + **elevation profile** + line-of-sight), **Viewshed**,
**Isochrone (terrain traversability / reachability)**, **Shade (solar illumination via NAIF SPICE)**,
Curtain (ground-penetrating radar), Chemistry, Identifier (pixel value picking), TimeControl,
TiTiler + STAC + COG ingestion, MVT vector tiles, 10 layer types.

### What self-hosting actually costs
```
git clone https://github.com/NASA-AMMOS/MMGIS
cp sample.env .env && cp docker-compose.sample.yml docker-compose.yml
docker compose up -d      # image: ghcr.io/nasa-ammos/mmgis:development
```
- Needs **Node ≥ 22, PostgreSQL 16 + PostGIS** (bundled in the compose file), Docker.
- Prebuilt image exists and resolves: https://github.com/NASA-AMMOS/MMGIS/pkgs/container/mmgis
- First-run: `/configure`, grab the one-time setup code from `docker logs`.
- Terrain: **you must pre-generate DEM tiles** with
  `auxillary/1bto4b/rasterstotiles1bto4b.py` and set the DEM URL per layer.
  (https://nasa-ammos.github.io/MMGIS/configure/tabs/panels)

**Honest assessment:** the `docker compose up` is 1–2 h. The hard part is authoring the mission JSON
(layers, projections, DEM URLs, styling) — that's the "unknown unknowns" zone. If nobody on the team
has run MMGIS before, **budget 10–14 h to a decent demo**, and you'll spend it on configuration, not
on the thing the judges care about (a coherent Marswalk narrative). It also gives you a *generic GIS*,
not *your* product.

**Recommendation:** don't fork MMGIS. **Do** steal its ideas — Isochrone/Viewshed/Shade are exactly
the right "mission planning" affordances, and you can implement cheap versions (slope-cost
traversability over the USGS slope GeoTIFF, sun-angle shading from a date) in a few hours.

---

## 4. Data layers obtainable in hours

Legend: **READY** = tiled/JSON endpoint, drop-in today. **PREP-1h** = download + `gdal2tiles`, ~1 h.
**PREP-4h** = clipping/reprojection/registration. **NO** = not in 36 h.

| Layer | Source | Format | Ready? | Effort |
|---|---|---|---|---|
| **Optical basemap (global)** | Trek WMTS (Viking 232 m / MOLA shade 463 m) | XYZ 256px, CORS `*` | **READY** | 0 |
| **Optical (Jezero, 6 m CTX)** | USGS Astrogeology GeoTIFF, 36 MB | GeoTIFF, CORS `*` | **PREP-1h** | 1 h |
| **Optical (Jezero, 25 cm HiRISE)** | USGS GeoTIFF, **3.4 GB** | GeoTIFF | PREP-4h | 4 h (clip first) |
| **Optical (Gale, 25 cm HiRISE)** | Trek `curiosity_hirise_mosaic` ImageServer | live `exportImage` | **READY** | 0 |
| **Topography (global 200 m)** | Trek `Mars_MOLA_blend200ppx_HRSC_*` / ASU WMS `mola_hrsc_blend_color` | live | **READY** | 0 |
| **Topography (Jezero 20 m DEM)** | USGS, 9.7 MB | GeoTIFF, CORS `*` | **PREP-1h** | 1 h |
| **Topography (Jezero 1 m)** | USGS HiRISE DTM, **1.84 GB** | GeoTIFF | PREP-4h | 4 h |
| **Slope (Jezero 20 m)** | USGS, 44 MB, purpose-built | GeoTIFF, CORS `*` | **PREP-1h** | 1 h |
| **Thermal inertia (100 m)** | ASU WMS `thm_ti_100m_8bit` | WMS PNG | **READY\*** | proxy only |
| **Thermal inertia (GeoTIFF)** | `https://www.mars.asu.edu/data/tes_putzigti/nightside2007/NBmap2007.tif` (78 MB) | GeoTIFF | PREP-2h | 2 h |
| **THEMIS day IR (100 m)** | Trek `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018` | XYZ, CORS `*` | **READY** | 0 |
| **Spectral (CRISM/OMEGA minerals)** | Trek `Hydrous_Mineral_Detections_OMEGA_CRISM_clon0` MapServer; ASU WMS `omega_olivine_map`, `omega_hydrated_mineral_map` | live | **READY\*** | 0 / proxy |
| **Subsurface ice (SWIM/HEND)** | ASU WMS `swim_ice_consistency_combined`, `swim_ice_consistency_0-1m`, `swim_neutron_dataset` | WMS | **READY\*** | proxy |
| **Atmosphere (MSL/REMS)** | `https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json` | JSON, **CORS `*`** | **READY** | 0 |
| **Atmosphere (MEDA/Perseverance)** | PDS4 per-sol CSVs | CSV | PREP-2h | 2 h |
| **Radiation (MSL RAD)** | PDS PPI, per-sol fixed-width ASCII, ~17 MB/sol | ASCII | **NO** | — |

\* ASU WMS has **no CORS header** (verified: response has only `Content-Type`, `Cache-Control`). You
must proxy it. That's ~20 lines in Vite/Next/Caddy and adds `Access-Control-Allow-Origin: *`.

### 4a. ASU / JMARS WMS — the single biggest unlock
```
https://ms-mars.mars.asu.edu/?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1
  &FORMAT=image/png&SRS=EPSG:4326&LAYERS={layer}
  &BBOX={w},{s},{e},{n}&WIDTH=512&HEIGHT=512&STYLES=
```
- GetCapabilities: https://ms-mars.mars.asu.edu/?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.1.1
  → **3.8 MB, 3 158 layers.** Free, no key.
- Verified rendering at Jezero: `thm_ti_100m_8bit` (47 KB PNG), `mola_hrsc_blend_color`,
  `thm_dirmola_100m_v13_4`, `omega_olivine_map`, `omega_hydrated_mineral_map`,
  `global_clindex_250_250_colorized2_v1`.
- Layers are named for exactly your use case: `THM_000613 | Gale Crater (THERMAL INERTIA)`,
  `swim_ice_consistency_*`, `crism_co2_frost_probability_ls_*`.
- **Float32 layers cannot be served as PNG** ("PNGs can only be created from 1 or 3 band byte data")
  and `image/tiff` is *not* offered (`InvalidFormat`). So slope/DEM/SWIM must come from the colorized
  8-bit siblings or from GeoTIFF elsewhere. Test the layer before you build UI around it.
- `GetFeatureInfo` → `LayerNotQueryable` for the layers I tried. **No server-side pixel sampling**;
  do value-picking client-side on your own rasters.

### 4b. USGS Astrogeology — the high-res Jezero/Gale files
Landing pages (all links verified live today):
- https://astrogeology.usgs.gov/search/map/mars-2020-jezero-crater-landing-site-products
- https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_ctx_dtm_mosaic
- https://astrogeology.usgs.gov/search/map/mars_2020_terrain_relative_navigation_hirise_orthorectified_image_mosaic
- https://astrogeology.usgs.gov/search/map/topographic_slopes_of_mars_2020_landing_site_jezero_west
- https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_dem_1m
- https://astrogeology.usgs.gov/search/map/mars_msl_gale_merged_orthophoto_mosaic_25cm

Direct files (302 → S3, **`Access-Control-Allow-Origin: *`**, sizes measured):

| File | Size |
|---|---|
| `planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif` | **9.7 MB** |
| `planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0.tif` | **36 MB** |
| `planetarymaps.usgs.gov/mosaic/mars2020_landing_site_dtm/J03_045994_1986_J03_046060_1986_20m_slope_20m.tif` | **44 MB** |
| `planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_006_DTM_..._1m_..._blend40.tif` | 1.84 GB |
| `planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/JEZ_hirise_soc_007_orthoMosaic_25cm_Ortho_blend120.tif` | 3.41 GB |
| `planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif` | 3.87 GB |
| `planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_Orthophoto_Mosaic_25cm_v3.tif` | 24.4 GB |

**Do not download the GB-scale ones.** Use the Trek ImageServer for Gale (live, 25 cm) and the 6 m
CTX ortho for Jezero. If you need 1 m Jezero, `gdal_translate -projwin` a route-corridor subset first.

Tiling recipe that matches Cesium exactly:
```bash
gdal2tiles.py -p geodetic --xyz -z 6-14 JEZ_ctx_6m.tif ./tiles/jezero
```
`--xyz` is the part that matters: GDAL documents it as "tiles at y=0 are the northern-most tiles
(used by OGC WMTS too)" — which is what Cesium's `{y}` expects. Default (TMS) mode puts y=0 at the
south and will render your map upside-down. The `geodetic` profile is the 2-tiles-wide-at-z0 scheme
that matches Trek — confirm with a directory listing on first run, then reuse the flags.
https://gdal.org/en/stable/programs/gdal2tiles.html

### 4c. Atmosphere — the one genuinely live API
```
https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json
```
- **CORS `*`**, 1.7 MB, no key.
- `soles` array: **4 745 sols, sol 1 (2012-08-07) → sol 4995 (2026-08-25)**; 4 717 with real data.
- Fields: `min_temp, max_temp, pressure, abs_humidity, wind_speed, wind_direction, atmo_opacity,
  sunrise, sunset, local_uv_irradiance_index, min_gts_temp, max_gts_temp, ls, season`.
- Latest sol sample: `min_temp -71, max_temp -5, pressure 777, atmo_opacity "Sunny"`.

**But be honest in the UI:** `atmo_opacity` is *qualitative* ("Sunny"/"Cloudy"), **not** a numeric
dust optical depth (τ). There is no public τ JSON.

Perseverance/MEDA: `?category=mars2020&feedtype=json` returns 1 368 bytes of `"--"` placeholders
(last real row 2024-04-21) — **effectively dead, don't use it.**
Real MEDA is PDS4:
- https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_derived_env/
- Per-sol CSVs, e.g. `sol_1740_1859/sol_1742/WE__1742___________DER_TIRS________________P01.CSV`
  (6.8 MB, 1 Hz, `DOWNWARD_LW_IRRADIANCE`, `UPWARD_LW_IRRADIANCE`, `ROVER_LOW_TILT`, …).
  **τ must be derived from irradiance — that's a research task, not a 36 h task.**
- Whole derived bundle is 3.8 GB; calibrated 12.9 GB. Don't.

### 4d. Radiation — **NOT REALISTIC**
`https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/DATA/` has per-sol fixed-width ASCII at
~17 MB **per sol**, hundreds of sols, with a `.FMT` spec per product. No JSON, no CSV, no API.
**Do this instead:** present a literature-anchored constant/curve (Hassler et al. 2014: surface dose
≈0.21 mGy/day in the E detector) and modulate by elevation/atmosphere in your narrative. Say in the
UI that it's a model, not telemetry. Judges respect that more than a broken parser.

### 4e. Subsurface hydrogen / ice
ASU WMS `swim_ice_consistency_combined`, `swim_ice_consistency_0-1m`, `swim_ice_consistency_1-5m`,
`swim_ice_consistency_grtr_5m`, `swim_neutron_dataset` — SWIM 2.0 (Odyssey neutron + radar).
Colorized variants render as PNG; the float ones don't (see 4a). **Proxy + READY.**

---

## 5. Existing "Mars in Cesium" starting points — **USABLE NOW**

**Use this one.** Official, MIT, maintained, and it does 80% of your scene setup:
- `Apps/Sandcastle/gallery/Mars.html` (Cesium repo, PR #12828) —
  https://raw.githubusercontent.com/CesiumGS/cesium/refs/pull/12828/head/Apps/Sandcastle/gallery/Mars.html
- Live Sandcastle gallery entry titled **"Cesium Mars"**:
  https://sandcastle.cesium.com/ (search "Mars")
- Companion data: `Apps/SampleData/Mars.czml` (Curiosity + Perseverance + Ingenuity tracks, plus
  "Mark Watney's journey"), `MarsPointsOfInterest.geojson`, `models/Mars/*.glb`.

Third-party, **use with caution**:
- `aaron43210/mars-globe` — https://github.com/aaron43210/mars-globe and npm `mars-globe@1.0.2`
  (published 2026-10-11). Claims "drop-in Mars globe, Mars IAU 2000 ellipsoid, Trek basemaps, no ion
  token". **0 stars, repo created 2026-11-12, no LICENSE file in the repo** (metadata claims MIT).
  I independently verified its core claim: its tile URL pattern
  `trek.nasa.gov/tiles/Mars/EQ/{ds}/1.0.0//default/default028mm/{z}/{y}/{x}.{ext}` **is correct**,
  and its dataset names (`THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018` etc.) **work**. Treat it as
  a worked example to read, not a dependency.
- `pablo-mayrgundter/cesium-portal` — https://github.com/pablo-mayrgundter/cesium-portal
  (README only, 0 stars, Oct 2026). Ignore.

There is **no** NASA-published open 3D Mars globe on the web other than Cesium Mars (ion) and the
Trek 3D view (which *is* Cesium under the hood, but not open-sourced).

---

## 6. Bevy 0.20 — **NOT REALISTIC**

**It exists.** `bevy 0.20.1`, published **2026-10-28** (i.e. ~2.5 weeks old today).
- https://crates.io/crates/bevy — versions: 0.20.1, 0.20.0, 0.20.0-rc.2, 0.19.1, …
- Release notes: https://bevy.org/news/bevy-0-20 (817 PRs)

**Geospatial ecosystem: real, but embryonic and Earth-only.**

| Crate/repo | State | Problem for you |
|---|---|---|
| `bevytiles` (ziv) | v0.1.0, **118 downloads**, 54★, created 2026-08-20 | "visualize any location on **Earth**" |
| `bevy_3d_tiles` (Arvikasoft) | v0.5.1, 854 downloads, Oct 2026 | **hardcodes `WGS84_EQUATORIAL_RADIUS_M`** (verified in `src/lib.rs`) |
| `bevy-cesium` (elodin-sys) | **4★**, created 2026-10-13, no crates.io release | one month old, Apache-2.0, wraps Cesium Native (WGS84-centric) |
| `bevy_geo_tiles` | v0.2.1, 164 downloads, "work in progress" | TMS slippy maps |

Also: 0.20 is brand new, so most third-party crates still target 0.19 — you'd be pinning and patching
during the hackathon.

**Verdict:** to ship Mars in Bevy you would have to fork the 3D Tiles loader to accept a Mars
ellipsoid, write your own LOD/quadtree for imagery, and hand-roll coordinate conversion — none of
which is the thing being judged. **Do not do this.** If the team wants Rust in the story, use it for
a *backend* (tile proxy, slope/traversability computation, routing) behind a CesiumJS front end.

---

# If I had 36 hours — recommended stack

**One sentence:** CesiumJS + Mars ellipsoid globe + NASA Trek WMTS basemap + 3–4 live overlay
services + the real Perseverance traverse as the route, with a second "walk mode" on the ion Mars
tileset. Ship a narrative, not a GIS.

### Hour 0–3 — Skeleton (do this before anything else)
- Vite + TypeScript + `cesium@1.147`.
- `Cesium.Ellipsoid.default = Cesium.Ellipsoid.MARS`, `Globe(Ellipsoid.MARS)`,
  `SkyAtmosphere(Ellipsoid.MARS)`, Mars atmosphere coefficients + bloom (copy from `Mars.html`).
- **Smoke test:** one `UrlTemplateImageryProvider` on Trek MOLA shade, fly to Jezero (77.45, 18.44).
  If this renders, you have a product. If it doesn't, you've lost 3 h, not 20.

### Hour 3–10 — The map (all zero-preprocessing)
1. **Basemap** — Trek WMTS `Mars_Viking_MDIM21_ClrMosaic_global_232m` (global) + swap to
   `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018` (z≤9) for the Jezero view.
2. **Route** — `Perseverance_Traverse_Path` GeoJSON (332 segments, CORS). Colour by `sol`,
   click a segment → "Sol N, X m driven".
3. **Overlays (3+ data types, satisfied):**
   - Thermal: Trek `THEMIS_DayIR` tiles + ASU WMS `thm_ti_100m_8bit` (via 20-line proxy)
   - Topographic: Trek `Mars_MOLA_blend200ppx_HRSC_ClrShade` ImageServer
   - Spectral: Trek `Hydrous_Mineral_Detections_OMEGA_CRISM_clon0` MapServer
   - Ice: ASU WMS `swim_ice_consistency_combined`
   - Atmospheric: MSL JSON → a sol-slider showing min/max temp + pressure + opacity at Gale
4. **Layer panel** with opacity sliders + attribution line. This *is* the deliverable.

### Hour 10–18 — The "hyperlocal" differentiator
- Download the three small USGS Jezero files (9.7 MB DEM, 36 MB CTX ortho, 44 MB slope).
  `gdal2tiles.py -p geodetic --xyz -z 8-14` each. Serve statically. Now you have **6 m optical +
  20 m DEM + 20 m slope** for the actual landing site, which Trek's WMTS cannot give you.
- Compute a **traversability cost surface** from the slope raster (e.g. cost = 1 + (slope/10)²) and
  draw a least-cost path between two waypoints. This is the single most "mission planning" feature
  you can build in a day, and it's ~150 lines.
- Elevation profile chart along the route, sampled from the DEM.

### Hour 18–26 — Walk mode
- `Cesium3DTileset.fromIonAssetId(3644333)` at Jezero (6 m imagery / 20 m terrain) or Gale
  (25 cm / 1 m).
- First-person camera at 1.7 m eye height, `HeadingPitchRoll`, terrain collision.
- POI billboards from the official `MarsPointsOfInterest.geojson`.
- Keep this **strictly separate** from Map mode — remember, imagery layers don't drape on the tileset.

### Hour 26–32 — Polish
- Sun position from a chosen sol. **Do not** use `Cesium.Simon1994PlanetaryPositions` — that is
  Earth-specific. Easiest honest path: hardcode a few (Ls, subsolar lat/lon) pairs from a Mars
  almanac and interpolate; a directional light + `Model` shadows gets you 90% of the visual payoff.
- A "survival" panel: radiation (labelled as modelled), temperature range from MSL JSON,
  dust/opacity, ice consistency at the current cursor (read from your own raster, not GetFeatureInfo).
- Loading states. Cesium's default token spinner looks broken on slow Trek tiles.

### Hour 32–36 — Freeze
No new data sources. Record the demo video at hour 33. Attribution screen.

### Explicitly do NOT do
- ❌ MMGIS self-host (10–14 h of config, and it's not your product)
- ❌ Bevy / Rust rendering
- ❌ MEDA PDS bundles (GB-scale, τ requires derivation)
- ❌ MSL RAD parsing (17 MB/sol fixed-width ASCII, no API)
- ❌ HiRISE 1 m Jezero GeoTIFF (3.4 GB) unless you `gdal_translate -projwin` a corridor first
- ❌ Float32 WMS layers (server rejects PNG and TIFF)
- ❌ Draping thematic rasters onto the Cesium Mars 3D Tiles — architecturally impossible

### The two facts that decide the architecture
1. `Cesium.Ellipsoid.MARS` exists and **Trek WMTS uses the identical CRS and the identical 2×1-at-z0
   tiling scheme**. Imagery layers are a config object, not a project.
2. Cesium Mars (ion 3644333) already has **Jezero at 6 m/20 m and Gale at 25 cm/1 m** as 3D Tiles —
   so you never need to process the multi-GB USGS mosaics for the 3D view.

Everything else is narrative.
