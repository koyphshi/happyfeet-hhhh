// Convert the USGS Gazetteer of Planetary Nomenclature (Mars, feature centre points) into the
// compact JSON the viewer loads: web/public/data/nomenclature/mars_named_features.json
//
// Source (public, IAU-approved names, MDIM 2.1 coordinates, planetocentric, 0-360 E):
//   https://planetarynames.wr.usgs.gov/GIS_Downloads
//   -> https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MARS_nomenclature_center_pts.zip
// Unzip it, then run:
//   node scripts/usgs-nomenclature.mjs path/to/MARS_nomenclature_center_pts.dbf
//
// Only node built-ins: the .dbf (dBASE III) table is read directly.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dbfPath = process.argv[2];
if (!dbfPath) {
  console.error("Usage: node scripts/usgs-nomenclature.mjs MARS_nomenclature_center_pts.dbf");
  process.exit(2);
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "web/public/data/nomenclature/mars_named_features.json");

// ---- read the dBASE table
const buf = readFileSync(dbfPath);
const count = buf.readUInt32LE(4), headerLen = buf.readUInt16LE(8), recLen = buf.readUInt16LE(10);
const fields = [];
for (let o = 32; buf[o] !== 0x0d; o += 32) {
  fields.push({ name: buf.toString("latin1", o, o + 11).replace(/\0.*$/, ""), len: buf[o + 16] });
}
function record(i) {
  let o = headerLen + i * recLen;
  const deleted = buf[o] === 0x2a; // '*'
  o += 1;
  const r = {};
  for (const f of fields) { r[f.name] = buf.toString("utf8", o, o + f.len).trim(); o += f.len; }
  return deleted ? null : r;
}

// ---- feature classes -> the viewer's kinds (one colour each on the map)
const CLASS = {
  Crater: "Crater",
  Mons: "Mountain & volcano", Tholus: "Mountain & volcano", Patera: "Mountain & volcano", Collis: "Mountain & volcano",
  Vallis: "Valley & canyon", Chasma: "Valley & canyon", Fossa: "Valley & canyon", Catena: "Valley & canyon",
  Sulcus: "Valley & canyon", Labyrinthus: "Valley & canyon",
  Planitia: "Plain & plateau", Planum: "Plain & plateau", Vastitas: "Plain & plateau", Terra: "Plain & plateau",
  Palus: "Plain & plateau", Mensa: "Plain & plateau",
  Dorsum: "Ridge & cliff", Rupes: "Ridge & cliff", Scopulus: "Ridge & cliff", Serpens: "Ridge & cliff", Lingula: "Ridge & cliff",
  Chaos: "Chaos & pit", Cavus: "Chaos & pit", Labes: "Chaos & pit",
  Unda: "Dune & flow", Fluctus: "Dune & flow",
  Albedo: "Albedo feature", Macula: "Albedo feature",
};

const num = (v) => (v === "" || v == null ? null : Number(v));
const round = (v, d) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const features = [];
const unknown = new Set();
for (let i = 0; i < count; i++) {
  const r = record(i);
  if (!r || !r.clean_name) continue;
  const typeWord = r.type.split(/[ ,]/)[0];           // "Crater, craters" -> "Crater"
  const kind = CLASS[typeWord];
  if (!kind) { unknown.add(r.type); continue; }
  let lon = num(r.center_lon);
  if (lon > 180) lon -= 360;                          // 0..360 E -> -180..180
  const id = /Feature\/(\d+)/.exec(r.link)?.[1];
  features.push({
    id: id ? Number(id) : null,
    name: r.clean_name,
    display: r.name !== r.clean_name ? r.name : undefined, // keeps diacritics when they differ
    type: typeWord === "Albedo" ? "Albedo feature" : typeWord,
    kind,
    lat: round(num(r.center_lat), 4),
    lon: round(lon, 4),
    diameterKm: round(num(r.diameter), 1),
    origin: r.origin || undefined,
    approved: r.approvaldt ? r.approvaldt.slice(0, 4) : undefined,
    status: r.approval || undefined,
    quad: r.quad_name || undefined,
    quadCode: r.quad_code ? r.quad_code.toUpperCase().replace(/^MC(\d+)$/, "MC-$1") : undefined,
  });
}
if (unknown.size) console.warn("Skipped unknown feature types:", [...unknown].join("; "));
features.sort((a, b) => b.diameterKm - a.diameterKm || a.name.localeCompare(b.name));

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  provenance: {
    source: "USGS Astrogeology / IAU, Gazetteer of Planetary Nomenclature: Mars feature centre points",
    download: "https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MARS_nomenclature_center_pts.zip",
    gazetteer: "https://planetarynames.wr.usgs.gov/",
    featureUrl: "https://planetarynames.wr.usgs.gov/Feature/{id}",
    coordinates: "Planetocentric latitude, east longitude converted from 0-360 to -180..180 (MDIM 2.1 control)",
    converted: new Date().toISOString().slice(0, 10),
    converter: "scripts/usgs-nomenclature.mjs",
    count: features.length,
  },
  features,
}));
console.log(`Wrote ${features.length} named features to ${path.relative(ROOT, OUT)}`);
