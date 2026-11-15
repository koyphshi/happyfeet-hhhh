import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseRoute, plannerPath, excerptSampler, buildRoute, ROUTE_SCHEMA } from "../route-io.js";
import { SCENARIOS, DEFAULT_CREW } from "../survival.js";

const demo = JSON.parse(await readFile(new URL("../public/data/route.json", import.meta.url), "utf8"));

test("committed demo route parses and has the documented fields", () => {
  const r = parseRoute(demo);
  assert.equal(r.schema, ROUTE_SCHEMA);
  for (const k of ["profile", "crew", "path", "waypoints", "blackout", "eta_s", "timeline", "warnings", "reports", "terrain", "survival"]) assert.ok(k in r, k);
  assert.equal(r.waypoints[0].role, "haven");
  assert.equal(r.terrain.heights.length, r.terrain.cols * r.terrain.rows);
});

test("demo route is GO under standard suits and refused under degraded suits", () => {
  const again = (key) => buildRoute({ path: plannerPath(demo), waypoints: demo.waypoints, heightAt: excerptSampler(demo.terrain), crew: SCENARIOS[key].apply(DEFAULT_CREW), params: SCENARIOS[key].params });
  assert.equal(again("standard").survival.feasible, true);
  assert.match(again("degraded_b_o2").survival.verdict, /REFUSED — Crew B runs out of oxygen/);
  assert.match(again("degraded_b_water").survival.verdict, /REFUSED — Crew B .*cooling water/);
});

test("parseRoute rejects malformed input", () => {
  assert.throws(() => parseRoute({ schema: "nope" }), /not a happyfeet/);
  assert.throws(() => parseRoute({ ...demo, path: [demo.path[0]] }), /two points/);
  assert.throws(() => parseRoute({ ...demo, path: [{ lon: 1 }, { lon: 2 }] }), /lon, lat, elevation_m/);
  assert.throws(() => parseRoute("{bad json"));
});
