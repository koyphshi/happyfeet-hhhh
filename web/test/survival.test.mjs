import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRoute, walkingSpeed, segmentsOf, commsVisibility, DEFAULT_CREW, SCENARIOS, SURVIVAL_PARAMS, surfaceDistanceM } from "../survival.js";

// Synthetic straight walk east along -4.787 lat (boxwork region), 3 km out, gentle climb.
function line(km, rise = 30, n = 61) {
  const lat = -4.787, lon0 = 137.393, dLon = km * 1000 / (3_396_190 * Math.cos(lat * Math.PI / 180)) * 180 / Math.PI;
  return Array.from({ length: n }, (_, i) => ({ lon: lon0 + dLon * i / (n - 1), lat, elevationM: -4000 + rise * i / (n - 1) }));
}

test("speed is v0 on flat ground and slower uphill and on steep downhill", () => {
  assert.ok(Math.abs(walkingSpeed(0) - 2.5 / 3.6) < 1e-9);
  assert.ok(walkingSpeed(0.2) < walkingSpeed(0));
  assert.ok(walkingSpeed(-0.4) < walkingSpeed(0));
});

test("segment distances add up to the surface distance", () => {
  const p = line(3);
  const total = segmentsOf(p).reduce((s, g) => s + g.d, 0);
  assert.ok(Math.abs(total - surfaceDistanceM(p[0], p.at(-1))) < 1);
});

test("a short out-and-back is feasible with a reserve and a walk-back limit", () => {
  const p = line(3);
  const r = evaluateRoute(p, [{ name: "Ridge crest", index: 30 }, { name: "Hollow floor", index: 60 }]);
  assert.equal(r.feasible, true, r.verdict);
  assert.ok(r.verdict.startsWith("GO"));
  assert.ok(r.limiting.reserve_frac >= SURVIVAL_PARAMS.reserve_frac);
  assert.equal(r.crew.length, 2);
  for (const c of r.crew) assert.equal(c.walk_back.index, 60);
  assert.ok(Math.abs(r.distance_m - 6000) < 20);
  assert.equal(r.timeline.at(-1).name, "Haven (return)");
});

test("a long walk is refused and the reason names a crew member and a consumable", () => {
  const p = line(30, 200, 301);
  const r = evaluateRoute(p, [{ name: "Ridge crest", index: 100 }, { name: "Hollow floor", index: 200 }, { name: "Layer contact", index: 300 }]);
  assert.equal(r.feasible, false);
  assert.match(r.verdict, /^REFUSED — Crew [AB] (runs out of|would return with)/);
  assert.match(r.verdict, /oxygen|cooling water|battery/);
  // the walk-back limit is somewhere before the end
  for (const c of r.crew) assert.ok(c.walk_back.index < 300);
});

test("degraded scenario refuses the same route because of crew B's water", () => {
  const p = line(3);
  const stops = [{ name: "Ridge crest", index: 30 }, { name: "Hollow floor", index: 60 }];
  const crew = SCENARIOS.degraded_b_water.apply(DEFAULT_CREW);
  const r = evaluateRoute(p, stops, { crew });
  assert.equal(r.feasible, false);
  assert.match(r.verdict, /Crew B .*cooling water/);
});

test("steep segment is refused by the hard mask", () => {
  const p = line(0.2, 0, 3);
  p[1].elevationM += 60; // 100 m run, 60 m rise = 31 degrees
  const r = evaluateRoute(p, []);
  assert.equal(r.feasible, false);
  assert.ok(r.warnings.some((w) => w.code === "slope"));
});

test("a loop is not walked back again", () => {
  const out = line(1.5, 0, 31);
  const p = [...out, ...out.slice(0, -1).reverse()];
  const r = evaluateRoute(p, [{ name: "Turnaround", index: 30 }]);
  assert.equal(r.loop, true);
  assert.ok(Math.abs(r.distance_m - 3000) < 20);
});

test("line of sight: a wall between haven and walker creates a blackout warning", () => {
  const p = line(3, 0, 61);
  const wallLon = p[10].lon;
  const heightAt = (lon) => (Math.abs(lon - wallLon) < 0.002 ? -3900 : -4000);
  const vis = commsVisibility(p, heightAt);
  assert.equal(vis[0], true);
  assert.equal(vis[5], true);
  assert.equal(vis[40], false);
  const r = evaluateRoute(p, [], { visible: vis });
  assert.ok(r.blackout.length >= 1);
  assert.ok(r.warnings.some((w) => w.code === "blackout"));
});
