// Build web/public/data/route.json: the committed demo excursion.
// Uses the same router (web/pathfinding.js) and survival model (web/survival.js) as the page,
// against a running terrain server:  cd web && node serve.mjs --no-open   then
//   node scripts/make-demo-route.mjs [--base http://localhost:8080] [--level 10]
import { writeFile } from "node:fs/promises";
import { loadTerrainPatch, lonLatToTerrainCell, planTerrainRoute, smoothTerrainPath } from "../web/pathfinding.js";
import { buildRoute } from "../web/route-io.js";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://localhost:8080");
const LEVEL = Number(arg("--level", "10"));
const OUT = new URL("../web/public/data/route.json", import.meta.url);
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o = {}) => { const { cache, ...rest } = o; return realFetch(new URL(u, BASE), rest); };

// Stops are placed at Curiosity's own localized positions during the boxwork campaign
// (public/data/curiosity/curiosity_traverse.geojson, PLACES localizations). The target
// type of each stop (ridge crest / hollow floor / layer contact) is ASSUMED for the demo.
const waypoints = [
  { name: "Haven (pressurized rover)", role: "haven", lon: 137.3895793, lat: -4.7935681, note: "Curiosity position, Sol 4500" },
  { name: "Ridge crest", role: "science", lon: 137.3812512, lat: -4.8023264, note: "Curiosity position, Sol 4580" },
  { name: "Hollow floor", role: "science", lon: 137.3793537, lat: -4.8066905, note: "Curiosity position, Sol 4641" },
  { name: "Layer contact", role: "science", lon: 137.3812465, lat: -4.8082715, note: "Curiosity position, Sol 4680" },
];
const loop = [...waypoints, { ...waypoints[0], name: "Haven (return)" }];
const pad = 0.01;
const bounds = {
  west: Math.min(...loop.map((p) => p.lon)) - pad, east: Math.max(...loop.map((p) => p.lon)) + pad,
  south: Math.min(...loop.map((p) => p.lat)) - pad, north: Math.max(...loop.map((p) => p.lat)) + pad,
};
console.log("loading terrain", bounds, "level", LEVEL);
const grid = await loadTerrainPatch({ ...bounds, level: LEVEL, onProgress: (p) => process.stdout.write(`\r tiles ${p.done}/${p.total} (preparing ${p.preparing})   `) });
console.log(`\ngrid ${grid.width}x${grid.height}, ${grid.source}`);
const path = [];
for (let i = 1; i < loop.length; i++) {
  const a = lonLatToTerrainCell(grid, loop[i - 1].lon, loop[i - 1].lat), b = lonLatToTerrainCell(grid, loop[i].lon, loop[i].lat);
  const leg = await planTerrainRoute(grid, a, b, { maxSlopeDeg: 25 });
  if (!leg) throw new Error(`no route for leg ${i}`);
  const pts = leg.displayPath.map((p) => ({ lon: p.lon, lat: p.lat, elevationM: p.elevationM }));
  pts[0] = { ...pts[0], lon: loop[i - 1].lon, lat: loop[i - 1].lat };
  pts[pts.length - 1] = { ...pts.at(-1), lon: loop[i].lon, lat: loop[i].lat };
  path.push(...pts.slice(path.length ? 1 : 0));
}
const route = buildRoute({
  path, waypoints: loop, grid,
  meta: { label: "Demo excursion: haven → ridge crest → hollow floor → layer contact → haven", generator: "scripts/make-demo-route.mjs" },
});
route.waypoints.forEach((w, k) => { if (loop[k].note) w.note = loop[k].note; });
route.profile.terrain_level = LEVEL;
// serve.mjs answers levels 9+ from the HRSC + MOLA blended DEM (~200 m/px); pathfinding.js labels every grid "MOLA".
if (LEVEL >= 9) route.profile.terrain_source = route.terrain.source = "USGS HRSC + MOLA blended DEM v2 (~200 m/px), via the local terrain service";
await writeFile(OUT, JSON.stringify(route, null, 1) + "\n");
console.log(route.survival.verdict);
console.log(`distance ${route.distance_m} m, eta ${(route.eta_s / 60).toFixed(0)} min, ${route.path.length} points -> ${OUT.pathname}`);
