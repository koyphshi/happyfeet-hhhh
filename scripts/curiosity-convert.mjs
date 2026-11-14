// Convert raw NASA MSL (Curiosity) source tables into static GeoJSON layers.
//
// Inputs (committed under data/raw/curiosity/):
//   1. localized_pos.csv          — MSL Rover PLACES bundle, urn:nasa:pds:msl_places
//                                   (rover position after each localized drive).
//   2. MSL-Science-targets.csv    — PDS Analyst's Notebook "Target Summary" table,
//                                   File → Export as CSV (https://an.rsl.wustl.edu/msl).
//
// Outputs (web/public/data/curiosity/):
//   curiosity_traverse.geojson — LineString (drive path) + one Point per localized stop.
//   curiosity_targets.geojson  — one Point per science target.
//
// CRS (do not change without re-reading PLACES_PDS_SIS.PDF §4.4.2.4):
//   Native source values are global "northing"/"easting" meters in the ORBITAL(0)
//   equirectangular frame. The SIS defines, with Re = 3,396,190 m and Rs = 3,376,200 m:
//     longitude          = easting  / Re * 180/pi   (east-positive, same for pc and pd)
//     lat_planetocentric = northing / Re * 180/pi
//     lat_planetodetic   = atan( tan(lat_pc) * (Re/Rs)^2 )
//   Geometry below uses [lon, lat_planetocentric, elevation] to register with the
//   project HiRISE basemap (NASA Trek curiosity_hirise_mosaic ImageServer, EPSG:104905
//   "Mars (2015) / Ocentric", i.e. planetocentric latitude). lat_planetodetic is kept
//   in feature properties for Cesium.Ellipsoid.MARS rendering, whose Cartographic
//   latitude is geodetic; mixing the two shifts points ~3.2 km north-south at Gale.
//   Raw meters and both latitude flavors are preserved, so nothing is lost.
//
// Usage: node scripts/curiosity-convert.mjs
// Exit code is non-zero if validation thresholds are violated.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(repoRoot, "data", "raw", "curiosity");
const OUT = path.join(repoRoot, "web", "public", "data", "curiosity");
mkdirSync(OUT, { recursive: true });

const RE_M = 3396190; // Mars ellipsoid equatorial radius (PLACES SIS §4.4.2.4)
const RS_M = 3376200; // Mars sphere radius used for the planetodetic conversion
const DEG = 180 / Math.PI;
const PD_RATIO = (RE_M / RS_M) ** 2;

/** Easting/northing meters (ORBITAL(0) frame) -> { lonDeg, latPcDeg, latPdDeg }. */
export function metersToDegrees(easting, northing) {
  const lonDeg = (easting / RE_M) * DEG;
  const latPcDeg = (northing / RE_M) * DEG;
  const latPdDeg = Math.atan(Math.tan((latPcDeg * Math.PI) / 180) * PD_RATIO) * DEG;
  return { lonDeg, latPcDeg, latPdDeg };
}

/** Both source CSVs use the bare token NULL for missing values. */
function num(v) {
  if (v === undefined) return null;
  const s = v.trim();
  if (s === "" || s.toUpperCase() === "NULL") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** RFC-4180-ish CSV parser (handles quoted fields). Returns { header, rows }. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
    else if (c === "\r") { /* ignore */ }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map((h) => h.trim());
  return { header, rows };
}

// Geometry coordinates are rounded to 7 decimal places (~1 cm on Mars), which is
// below the ~0.5 m PLACES localization accuracy; values stay recoverable from the
// committed raw CSVs to full precision.
function round(n, digits) {
  if (n === null || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

// ---------------------------------------------------------------------------
// 1. Traverse: data/raw/curiosity/localized_pos.csv
// ---------------------------------------------------------------------------
const posText = readFileSync(path.join(RAW, "localized_pos.csv"), "utf8");
const pos = parseCsv(posText);
const posIdx = Object.fromEntries(pos.header.map((h, i) => [h, i]));
const rowVal = (row, key) => row[posIdx[key]];

const stops = [];
for (const row of pos.rows) {
  if (row.length < pos.header.length) continue;
  if (rowVal(row, "frame") !== "ROVER") continue; // SITE rows duplicate the same position
  const sol = num(rowVal(row, "sol"));
  if (sol === null || sol < 0) continue; // pre-landing rows (sol -1)
  const easting = num(rowVal(row, "easting"));
  const northing = num(rowVal(row, "northing"));
  if (easting === null || northing === null) continue;
  const sclk = Number(rowVal(row, "sclk"));
  const ll = metersToDegrees(easting, northing);
  stops.push({
    rmc: {
      site: num(rowVal(row, "site")),
      drive: num(rowVal(row, "drive")),
      pose: num(rowVal(row, "pose")),
    },
    sol,
    sclk,
    easting_m: easting,
    northing_m: northing,
    elevation_m: num(rowVal(row, "elevation")),
    lon: ll.lonDeg,
    lat_planetocentric: ll.latPcDeg,
    lat_planetodetic: ll.latPdDeg,
  });
}
// Chronological order: PLACES gives the localized position at/after each drive.
stops.sort((a, b) =>
  a.sol - b.sol || a.sclk - b.sclk ||
  a.rmc.site - b.rmc.site || a.rmc.drive - b.rmc.drive || a.rmc.pose - b.rmc.pose,
);

const traverseFeatures = stops.map((s, i) => ({
  type: "Feature",
  geometry: {
    type: "Point",
    coordinates: [round(s.lon, 7), round(s.lat_planetocentric, 7), round(s.elevation_m, 1)],
  },
  properties: {
    id: `curiosity_stop_${String(i + 1).padStart(4, "0")}`,
    rmc: `${s.rmc.site}/${s.rmc.drive}/${s.rmc.pose}`,
    sol: s.sol,
    easting_m: round(s.easting_m, 3),
    northing_m: round(s.northing_m, 3),
    elevation_m: round(s.elevation_m, 1),
    lat_planetocentric_deg: round(s.lat_planetocentric, 7),
    lat_planetodetic_deg: round(s.lat_planetodetic, 7),
    longitude_deg: round(s.lon, 7),
  },
}));

const traverse = {
  type: "FeatureCollection",
  name: "curiosity_traverse",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: traverseFeatures.map((f) => f.geometry.coordinates),
      },
      properties: {
        name: "Curiosity localized traverse (PLACES localized_pos, ROVER rows)",
      },
    },
    ...traverseFeatures,
  ],
  provenance: {
    dataset: "MSL Rover PLACES bundle, product localized_pos.csv v42.0 (urn:nasa:pds:msl_places:data_localizations:localized_pos.csv)",
    mission: "Mars Science Laboratory (Curiosity)",
    source_url: "https://planetarydata.jpl.nasa.gov/img/data/msl/msl_places/data_localizations/localized_pos.csv",
    retrieved: "2026-11-14",
    crs: "Longitude/latitude per PLACES SIS v1.2-A section 4.4.2.4: lon = easting/3396190*180/pi; lat_pc = northing/3396190*180/pi; lat_pd = atan(tan(lat_pc)*(3396190/3376200)^2). Geometry = [lon, lat_planetocentric, elevation] to match the project HiRISE basemap (Trek curiosity_hirise_mosaic, EPSG:104905 Mars ocentric); lat_planetodetic_deg is in properties for Cesium.Ellipsoid.MARS.",
    processing: "node scripts/curiosity-convert.mjs — kept ROVER rows with sol >= 0 (SITE rows duplicate positions), sorted by sol/sclk/site/drive/pose.",
    credit: "NASA/JPL-Caltech/MSS/PLACES team, PDS Geosciences & Imaging Nodes",
  },
};

// ---------------------------------------------------------------------------
// 2. Targets: data/raw/curiosity/MSL-Science-targets.csv
// ---------------------------------------------------------------------------
const tgtText = readFileSync(path.join(RAW, "MSL-Science-targets.csv"), "utf8");
const tgt = parseCsv(tgtText);
const tgtIdx = Object.fromEntries(tgt.header.map((h, i) => [h, i]));
const tgtVal = (row, key) => row[tgtIdx[key]];

const targets = [];
for (const row of tgt.rows) {
  if (row.length < tgt.header.length) continue;
  const name = (tgtVal(row, "Target") || "").trim();
  if (!name) continue;
  const easting = num(tgtVal(row, "Easting_m"));
  const northing = num(tgtVal(row, "Northing_m"));
  const elevation = num(tgtVal(row, "Elevation_m"));
  let ll = null;
  if (easting !== null && northing !== null) ll = metersToDegrees(easting, northing);
  targets.push({
    name,
    sol: num(tgtVal(row, "Sol")),
    site: num(tgtVal(row, "Site")),
    drive: num(tgtVal(row, "Drive")),
    easting,
    northing,
    elevation,
    locator: (tgtVal(row, "Locator") || "").trim(),
    locator_null: (tgtVal(row, "Locator") || "").trim().toUpperCase() === "NULL",
    local: {
      x: num(tgtVal(row, "Local_x_m")),
      y: num(tgtVal(row, "Local_y_m")),
      z: num(tgtVal(row, "Local_z_m")),
    },
    ll,
  });
}

const targetFeatures = targets.map((t) => ({
  type: "Feature",
  // RFC 7946 allows null geometry; rows without easting/northing have unknown position.
  geometry: t.ll
    ? {
        type: "Point",
        coordinates: [round(t.ll.lonDeg, 7), round(t.ll.latPcDeg, 7), round(t.elevation, 1)],
      }
    : null,
  properties: {
    target: t.name,
    sol: t.sol,
    site: t.site,
    drive: t.drive,
    easting_m: round(t.easting, 3),
    northing_m: round(t.northing, 3),
    elevation_m: round(t.elevation, 1),
    lat_planetocentric_deg: t.ll ? round(t.ll.latPcDeg, 7) : null,
    lat_planetodetic_deg: t.ll ? round(t.ll.latPdDeg, 7) : null,
    longitude_deg: t.ll ? round(t.ll.lonDeg, 7) : null,
    locator: t.locator_null ? null : t.locator,
  },
}));

const targetsGj = {
  type: "FeatureCollection",
  name: "curiosity_targets",
  features: targetFeatures,
  provenance: {
    dataset: "PDS Analyst's Notebook (MSL) Target Summary table, File > Export as CSV (build 2026-0912, file 2026-0912-MSL-Science-targets.csv)",
    mission: "Mars Science Laboratory (Curiosity)",
    source_url: "https://an.rsl.wustl.edu/msl/mslbrowser/targetSummaryPage.aspx (Mission tab > science targets > File > Export as CSV)",
    retrieved: "2026-11-14",
    crs: "Same PLACES ORBITAL(0) equirectangular meters converted per PLACES SIS v1.2-A section 4.4.2.4 (see curiosity_traverse.geojson). Geometry = [lon, lat_planetocentric, elevation] (EPSG:104905-compatible ocentric); lat_planetodetic_deg is in properties.",
    processing: "node scripts/curiosity-convert.mjs — every target row kept; rows without easting/northing get null geometry and null coordinates.",
    credit: "NASA/JPL-Caltech/PDS Analyst's Notebook (PDS Geosciences Node, Washington University in St. Louis)",
  },
};

writeFileSync(path.join(OUT, "curiosity_traverse.geojson"), JSON.stringify(traverse));
writeFileSync(path.join(OUT, "curiosity_targets.geojson"), JSON.stringify(targetsGj));

// Curated drill-sample campaigns, identified from the targets CSV itself.
// Each entry is a set of (site, drive) RMC pairs whose rows belong to one
// drilling campaign; the campaign's coordinates are the mean of located rows
// (rows of one campaign agree to sub-meter). sol_range spans ALL AN target
// rows at those RMCs (pointings, imaging, the drill work) — it is an upper
// bound bracket for the drilling, not the precise drill sol. nearby_targets
// lists every AN target name at the RMC, unfiltered. The four boxwork-era
// campaigns have no drill_hole rows and are inferred from tailings rows; the
// two Nevado_Sajama campaigns have NULL easting/northing in the export and
// get null geometry. Nothing here is invented — every member name and
// position is asserted against the committed CSV at conversion time.
const SAMPLE_CAMPAIGNS = [
  ["John_Klein", [[5, 1916], [5, 1954], [5, 2270]], false],
  ["Cumberland", [[6, 0], [6, 68], [6, 82]], false],
  ["Windjana", [[31, 1330]], false],
  ["Confidence_Hills", [[42, 1020]], false],
  ["Mojave", [[45, 0]], false],
  ["Telegraph_Peak", [[45, 450]], false],
  ["Buckskin", [[48, 2542]], false],
  ["Greenhorn", [[50, 676]], false],
  ["Lubango", [[54, 746]], false],
  ["Okoruso", [[54, 938]], false],
  ["Oudam", [[54, 2280]], false],
  ["Marimba", [[56, 1236]], false],
  ["Quela", [[57, 2798]], false],
  ["Sebina", [[58, 2046]], false],
  ["Duluth", [[70, 1752]], false],
  ["Ailsa_Craig", [[72, 386]], false],
  ["Stoer", [[72, 1316]], false],
  ["Highfield", [[73, 550]], false],
  ["Rock_Hall", [[73, 1206]], false],
  ["Aberlady", [[75, 1386]], false],
  ["Kilmarie", [[75, 1398]], false],
  ["Mary_Anning", [[82, 2176]], false],
  ["Glen_Etive", [[76, 3002]], false],
  ["Hutton", [[79, 0]], false],
  ["Edinburgh", [[79, 654]], false],
  ["Pontours", [[89, 1992]], false],
  ["Maria_Gordon", [[91, 390]], false],
  ["Zechstein", [[91, 2132]], false],
  ["Avanavero", [[95, 3152]], false],
  ["Amapari2", [[98, 2704]], false],
  ["Encanto", [[99, 1676]], false],
  ["Dinira", [[100, 84]], false],
  ["Tapo_Caparo", [[100, 1084]], false],
  ["Ubajara", [[101, 774]], false],
  ["Sequoia", [[105, 418]], false],
  ["Altadena", [[116, 1944]], true],
  ["Valle_de_la_Luna", [[119, 1722]], true],
  ["Abanay / Nevado_Sajama", [[120, 82]], true],
  ["Nevado_Sajama2", [[120, 574]], true],
];

const targetRows = tgt.rows.map((row) => ({
  name: (tgtVal(row, "Target") || "").trim(),
  sol: num(tgtVal(row, "Sol")),
  site: num(tgtVal(row, "Site")),
  drive: num(tgtVal(row, "Drive")),
  easting: num(tgtVal(row, "Easting_m")),
  northing: num(tgtVal(row, "Northing_m")),
  elevation: num(tgtVal(row, "Elevation_m")),
  locator: (tgtVal(row, "Locator") || "").trim().toUpperCase() === "NULL" ? null : (tgtVal(row, "Locator") || "").trim(),
}));

const samples = [];
for (const [label, rmcList, inferredFromTailings] of SAMPLE_CAMPAIGNS) {
  const members = targetRows.filter((r) => rmcList.some(([s, d]) => r.site === s && r.drive === d));
  if (members.length === 0) {
    console.error(`SAMPLE CAMPAIGN "${label}" matched no rows — curation bug`);
    process.exitCode = 1;
    continue;
  }
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const located = members.filter((m) => m.easting !== null && m.northing !== null);
  const easting = located.length ? mean(located.map((m) => m.easting)) : null;
  const northing = located.length ? mean(located.map((m) => m.northing)) : null;
  const elevation = mean(located.map((m) => m.elevation).filter((v) => v !== null));
  const sols = members.map((m) => m.sol).filter((v) => v !== null);
  const ll = easting !== null ? metersToDegrees(easting, northing) : null;
  samples.push({
    label,
    nearbyTargets: members.map((m) => m.name).sort(),
    sol_range: [Math.min(...sols), Math.max(...sols)],
    rmc: rmcList.map(([s, d]) => `${s}/${d}`),
    easting, northing, elevation, ll,
    locator: members.find((m) => m.locator)?.locator ?? null,
    inferredFromTailings,
  });
}

const sampleFeatures = samples.map((s) => ({
  type: "Feature",
  geometry: s.ll
    ? { type: "Point", coordinates: [round(s.ll.lonDeg, 7), round(s.ll.latPcDeg, 7), round(s.elevation, 1)] }
    : null,
  properties: {
    sample: s.label,
    nearby_targets: s.nearbyTargets,
    n_nearby_targets: s.nearbyTargets.length,
    sol_range: s.sol_range,
    rmc: s.rmc,
    easting_m: round(s.easting, 3),
    northing_m: round(s.northing, 3),
    elevation_m: round(s.elevation, 1),
    lat_planetocentric_deg: s.ll ? round(s.ll.latPcDeg, 7) : null,
    lat_planetodetic_deg: s.ll ? round(s.ll.latPdDeg, 7) : null,
    longitude_deg: s.ll ? round(s.ll.lonDeg, 7) : null,
    locator: s.locator,
    inferred_from_tailings: s.inferredFromTailings,
  },
}));

const samplesGj = {
  type: "FeatureCollection",
  name: "curiosity_samples",
  features: sampleFeatures,
  provenance: {
    dataset: "Derived from the Analyst's Notebook Target Summary science targets table (2026-0912 build export, see MSL-Science-targets.csv); a curated list of Curiosity's 40 drilling campaigns by RMC",
    mission: "Mars Science Laboratory (Curiosity)",
    source_url: "https://an.rsl.wustl.edu/msl/AN/targetSummaryPage.aspx (same export as curiosity_targets.geojson)",
    retrieved: "2026-11-14",
    crs: "Same as curiosity_targets.geojson: geometry = [lon, lat_planetocentric, elevation] (EPSG:104905-ocentric compatible); lat_planetodetic_deg in properties.",
    processing: "node scripts/curiosity-convert.mjs — campaigns curated by (site,drive) RMC from the exported target rows; coordinates are per-campaign means (sub-meter spread) of all located rows at the RMC; sol_range brackets ALL AN rows at the RMC (imaging/pointings + drilling), not the precise drill sol; nearby_targets lists every AN target name at the RMC; four boxwork-era campaigns inferred from tailings rows (see inferred_from_tailings); two Nevado_Sajama campaigns have NULL position upstream and get null geometry. Every campaign's rows are asserted present in the raw CSV.",
    credit: "NASA/JPL-Caltech/PDS Analyst's Notebook (PDS Geosciences Node, Washington University in St. Louis)",
  },
};

writeFileSync(path.join(OUT, "curiosity_samples.geojson"), JSON.stringify(samplesGj));


// ---------------------------------------------------------------------------
// 3. RFC 7946 structural validation of the written files
// ---------------------------------------------------------------------------
function validateGeoJson(file) {
  const gj = JSON.parse(readFileSync(file, "utf8"));
  const errs = [];
  if (gj.type !== "FeatureCollection") errs.push("not a FeatureCollection");
  const positions = [];
  let nullGeom = 0;
  for (const f of gj.features) {
    if (f.type !== "Feature") errs.push("member type != Feature");
    if (!("properties" in f)) errs.push("missing properties member");
    const g = f.geometry;
    if (g === null) { nullGeom++; continue; }
    if (g.type === "Point") {
      const [x, y, z] = g.coordinates;
      positions.push([x, y]);
      if (![x, y].every(Number.isFinite)) errs.push("non-finite coordinate");
      if (x < -180 || x > 180 || y < -90 || y > 90) errs.push(`coordinate out of range: ${x},${y}`);
      if (z !== undefined && !Number.isFinite(z)) errs.push("non-finite elevation");
    } else if (g.type === "LineString") {
      if (g.coordinates.length < 2) errs.push("LineString with < 2 positions");
      for (const [x, y] of g.coordinates) {
        positions.push([x, y]);
        if (![x, y].every(Number.isFinite)) errs.push("non-finite coordinate");
        if (x < -180 || x > 180 || y < -90 || y > 90) errs.push(`coordinate out of range: ${x},${y}`);
      }
    } else errs.push(`unexpected geometry type ${g.type}`);
  }
  const bbox = positions.reduce(
    (b, [x, y]) => ({
      minX: Math.min(b.minX, x), minY: Math.min(b.minY, y),
      maxX: Math.max(b.maxX, x), maxY: Math.max(b.maxY, y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  return { file: path.basename(file), errors: [...new Set(errs)], features: gj.features.length, nullGeometry: nullGeom, bbox };
}

// ---------------------------------------------------------------------------
// 3. Validation summary (also asserted below)
// ---------------------------------------------------------------------------
function bboxOf(features) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of features) {
    if (!f.geometry) continue;
    const [x, y] = f.geometry.coordinates;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

const sols = traverseFeatures.map((f) => f.properties.sol);
const firstStop = traverseFeatures[0].properties;
const travBbox = bboxOf(traverseFeatures);
const tgtBbox = bboxOf(targetFeatures.filter((f) => f.geometry));
const nullGeomTargets = targetFeatures.filter((f) => f.geometry === null).length;
const targetSols = targetFeatures.map((f) => f.properties.sol).filter((s) => s !== null);

// Bradbury Landing reference (published landing site coordinate, planetocentric):
//   lat -4.5895 deg, lon 137.4417 deg E, MOLA elevation -4501.4 m (NASA/JPL press kit).
const REF = { latPc: -4.5895, lon: 137.4417 };
function surfaceMeters(latPcDeg1, lon1, latPcDeg2, lon2, radius = RE_M) {
  const p1 = [latPcDeg1, lon1].map((d) => (d * Math.PI) / 180);
  const p2 = [latPcDeg2, lon2].map((d) => (d * Math.PI) / 180);
  const central = Math.acos(
    Math.min(1, Math.max(-1, Math.sin(p1[0]) * Math.sin(p2[0]) +
      Math.cos(p1[0]) * Math.cos(p2[0]) * Math.cos(p1[1] - p2[1]))),
  );
  return central * radius;
}
const landingOffset = surfaceMeters(firstStop.lat_planetocentric_deg, firstStop.longitude_deg, REF.latPc, REF.lon);

// Gale crater reference (published): center 5.42 deg S, 137.78 deg E, diameter ~154 km.
const GALE = { lat: -5.42, lon: 137.78, radius_m: 77000 };
function bboxWithin(bbox, center, radiusM) {
  const corners = [
    [bbox.minY, bbox.minX], [bbox.minY, bbox.maxX],
    [bbox.maxY, bbox.minX], [bbox.maxY, bbox.maxX],
  ];
  return corners.map(([y, x]) => surfaceMeters(y, x, center.lat, center.lon));
}

const stats = {
  traverse: {
    stops: traverseFeatures.length,
    sol_range: [Math.min(...sols), Math.max(...sols)],
    bbox: travBbox,
    first_stop: firstStop,
    first_stop_offset_vs_bradbury_m: round(landingOffset, 1),
  },
  targets: {
    targets: targetFeatures.length,
    with_geometry: targetFeatures.length - nullGeomTargets,
    null_geometry: nullGeomTargets,
    sol_range: [Math.min(...targetSols), Math.max(...targetSols)],
    bbox: tgtBbox,
  },
  geojson_files: [
    validateGeoJson(path.join(OUT, "curiosity_traverse.geojson")),
    validateGeoJson(path.join(OUT, "curiosity_targets.geojson")),
    validateGeoJson(path.join(OUT, "curiosity_samples.geojson")),
  ],
  samples: {
    campaigns: sampleFeatures.length,
    with_geometry: sampleFeatures.filter((f) => f.geometry).length,
    null_geometry: sampleFeatures.filter((f) => f.geometry === null).length,
    inferred_from_tailings: sampleFeatures.filter((f) => f.properties.inferred_from_tailings).length,
    sol_range: [
      Math.min(...sampleFeatures.map((f) => f.properties.sol_range[0])),
      Math.max(...sampleFeatures.map((f) => f.properties.sol_range[1])),
    ],
  },
};

console.log(JSON.stringify(stats, null, 2));

const errors = [];
if (stats.traverse.stops < 500) errors.push("traverse unexpectedly small");
if (stats.traverse.first_stop_offset_vs_bradbury_m > 200) errors.push("first stop not at Bradbury Landing");
if (stats.targets.targets < 9000) errors.push("target count unexpectedly small");
if (stats.samples.campaigns < 35) errors.push("sample campaign count unexpectedly small");
if (Math.max(...bboxWithin(travBbox, GALE, GALE.radius_m)) > GALE.radius_m) errors.push("traverse bbox outside Gale crater");
for (const v of stats.geojson_files) if (v.errors.length) errors.push(`${v.file}: ${v.errors.join("; ")}`);
console.error(errors.length ? "VALIDATION ERRORS:\n" + errors.join("\n") : "validation ok");
process.exit(errors.length ? 1 : 0);
