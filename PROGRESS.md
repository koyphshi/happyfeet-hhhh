# PROGRESS — Interplanetary Survival Guide: Martian Map

Repo: `Noxx67/happyfeet-mars-trip` · Hackathon deadline: Sun 15 Nov 2026 23:59 (first complete submission by 17:00)
Last updated: Sat 14 Nov 2026, ~14:30 (Africa/Algiers)

> **How "by who" was determined.** Names come from the git history (commit author + time), not from guesses.
> Caveat: a commit author is the person who *committed* the work. If someone pasted in text written
> elsewhere (e.g. by an AI assistant), git cannot show that. Items marked **(Claude)** were produced in the
> Claude chat session that is attached to this project. Anything that git can't attribute is marked *unknown*.

## People / identities seen in git

| Git name | Likely person / account | What they did |
|---|---|---|
| Nox | repo owner `Noxx67` | Created the repo (initial commit, LICENSE); merges PRs on GitHub |
| pixelguy126 | local git identity on the machine that holds `D:\mars` | Setup scripts, skills install, viewer prototype commit, commits Claude's output |
| Mehloul Mohamed (branch `moh`) | teammate | PLAN.md, RESEARCH file, assumptions.md (6 commits) |
| yasser lanacer / koyphshi (branch `koyphshi`) | teammate (commit author "yasser lanacer", PR opened from `koyphshi` account) | PLAN-integrity.md proposal |
| Claude (chat session) | AI assistant | Trek layer research, plan/research/integrity reviews, integrity assertions doc, step-1 globe, test checklist, this file |

## Timeline (all Sat 14 Nov 2026)

| Time | Who | What |
|---|---|---|
| 10:13 | Nox | Initial commit (LICENSE) |
| 11:10 | pixelguy126 | `setup.bat` / `setup.ps1` (Rust + Bevy + Cesium install), `Cargo.toml`, `src/main.rs`, `web/package.json`, `.gitignore` |
| 12:16 | Mehloul Mohamed | `PLAN.md` (v1), `RESEARCH-mars-cesium-feasibility.md`, `docs/assumptions.md` |
| 12:52 → 13:38 | Mehloul Mohamed | Four more `PLAN.md` revisions ("rdg", "test", "more", "more2"): P0–P3 feature list, spikes, data acquisition, VR HUD, explain/warnings, crew reports |
| 14:10 | pixelguy126 | Commit "koulou skills a wladi": `to-spec` skill (`.agents/skills`), `skills-lock.json`, `Cargo.lock`, `start-viewer.bat`, `web/serve.mjs`, `web/package-lock.json`, first `web/index.html` (158 lines) |
| 14:10 | yasser lanacer | `PLAN-integrity.md` (signed data manifest + Z3 route verification proposal); merged 14:15 via PR #6 |
| 14:23 | pixelguy126 | Commit "claude did his thing": `docs/integrity-assertions.md` (Claude's rewrite of the integrity section as assertions) |
| afternoon | Claude (Claude Code) | Fixed "planet not showing": Trek is 2–10 s/tile and the page flew away before the globe loaded. `serve.mjs` now has a disk tile cache + retry + warm-up; page auto-uses the proxy, waits for the globe before flying, shows load progress, HiRISE starts at level 8 (no grey smear). Verified in headless Chrome. `cesium` added to `web/package.json`. |
| later | Claude (Claude Code) | Browser tile cache (`web/tile-sw.js` service worker, Cache Storage, with count/size + Clear button), 1000-tile in-memory cache, 30-day cache headers; scale bar + "to centre" / "view width" distances; tilted view (Top-down / Tilted 60° buttons + 0–80° slider). Checked in headless Chrome. Tilt shows flat imagery in perspective; no 3D terrain yet. |
| later | Claude (Claude Code) | Hand tilt: hold left + right mouse buttons and drag up/down; two-finger touch drag; every tilt capped at 60°. Mouse chord + cap checked in headless Chrome; touch not tested on a real device. |

## Status by area

### 1. Planning & research — done (iterating)
- `PLAN.md` — frozen-decisions plan, P0 #1–7 (globe, layer panel + provenance, POIs, A* route, route card, comms line-of-sight, VR HUD), P1/P2/P3, spikes 1–6, data acquisition, explain/warnings, crew reports. **By Mehloul Mohamed.** Reviewed by Claude; known issues: tile template says `.jpg` (extension is per layer), spike 4 says "18°N" (Gale is ~5°S), exportImage vs WMTS resolution mix-up, a stray unfinished line.
- `RESEARCH-mars-cesium-feasibility.md` — Cesium + Mars + NASA Trek + MMGIS + Bevy feasibility. **By Mehloul Mohamed.** Read by Claude.
- `docs/assumptions.md` — coefficient table; **mostly empty** (only g_mars, reserve, blackout grace, dose rate filled; g_mars unsourced). **By Mehloul Mohamed.**

### 2. Data / layer research — done (Claude)
- Mapped the 17 global NASA Trek Mars layers and ranked which matter for the project.
- Verified tile URL pattern, extensions and max zoom by probing next-level 404s: Viking z7, MOLA 463 m z7, MOLA/HRSC 200 m z8, Gale HiRISE mosaic z16 (~0.64 m/px, not 25 cm; true 25 cm needs ArcGIS `exportImage`).
- Explained where MOLA / HRSC / SpaceEngine data comes from and how to download MOLA.
- Found a bug in the earlier viewer: Viking dataset name was missing the `Mars_` prefix (fixed in the new page).

### 3. Integrity / verification — proposed + reworked
- `PLAN-integrity.md` — proposal. **By yasser lanacer (koyphshi).** Not yet merged into PLAN.md.
- `docs/integrity-assertions.md` — assertion-style version (D1–D10 data checks, R1–R10 route checks, P1–P3 parameter checks, optional Z3 checks, warn-only until the Sunday 15:00 freeze). **By Claude**, committed by pixelguy126 at 14:23. Needs a human decision before PLAN.md is edited.

### 3b. Step 1 — Mars globe (P0 #1) — built, tests 1–3 verified (headless Chrome), 4–9 need a human
- `web/index.html` rewritten by **Claude**: Cesium with the Mars ellipsoid, NASA Trek layers (Viking, MOLA+HRSC, MOLA, Gale HiRISE mosaic) with on/off + opacity, fly-to buttons, live lon/lat/alt readout.
- `docs/step1-test-checklist.md` by **Claude**: how to run + 9 tests.
- **These two files are on disk but not committed yet** (the 14:23 commit only contains `docs/integrity-assertions.md`).
- Status: never opened in a browser by Claude. Treat as untested until the checklist passes.
- Honest limitation: flat imagery only, no 3D terrain relief yet; Gale WMTS tops out at ~0.64 m/px.

### 4. Repo / tooling state
- `web/serve.mjs` + `start-viewer.bat` (local static server on :8080 with a `/trek` proxy) — committed by pixelguy126 (14:10); original author *unknown*.
- Cesium is installed in `web/node_modules` and `Cesium.js` exists, so the page can load it.
- Problems still open:
  - Leftover Rust/Bevy files (`Cargo.toml`, `Cargo.lock` ~6.5k lines, `src/main.rs`, `setup.ps1`, `setup.bat`) — PLAN.md dropped Bevy; candidates for deletion.
  - Unmerged remote branches: `origin/moh` (merged up to 819af81) and `origin/koyphshi` (merged). No open work seen on other branches at time of writing.
- Skills: `to-spec` installed (by pixelguy126, via `npx skills`) under `.agents/skills/` — Claude Code reads `.claude/skills/`, so it isn't picked up automatically.

## Not started yet (from PLAN.md)
- P0 #2–7: POI markers, A* route planner, route card, comms-blackout line-of-sight, VR HUD, layer provenance panel.
- Spike 2 (Gale 1 m DEM via `exportImage`: float vs 8-bit) — load-bearing for slope costs, still open.
- Spike 1 and the rest of the spikes.
- Filling in `docs/assumptions.md` with sourced coefficients.
- Crew field reports, explain/warnings UI, 7-slide deck.

## Suggested next steps
1. Open step 1 and run `docs/step1-test-checklist.md`; commit `web/index.html` + the checklist once it passes.
2. Add `cesium` to `web/package.json`; delete Bevy leftovers (team decision).
3. Run spikes 1–2 before building the route planner.
4. Decide whether to adopt `docs/integrity-assertions.md` into PLAN.md (yasser / Mehloul / Nox).
5. Fill the `assumptions.md` rows with sources.

_Keep this file updated: add a line per commit/task with the person's name._

---

## Sun 15 Nov 2026, 07:20–08:00 — agent:yasser (Claude Code on yasser's laptop)

Branch `agent/yasser-vr` (stacks `agent/yasser-p0` → `agent/yasser-integrity` → VR); fast-forwards `main`.
Tests: `cd web && npm test` → 21 passing. Browser checks: headless Chrome 147 against the local server and the Docker image.

| Area | What | Verified by |
|---|---|---|
| Survival card | `web/survival.js` O₂ / cooling water / battery per crew, 20 % reserve, walk-back limit, LOS blackout, slope mask, refusal naming crew + consumable; scenarios | node tests; headless: GO on demo, REFUSED on degraded scenarios |
| route.json | `web/route-io.js`, schema `docs/route-schema.md`, export / open / load demo; demo generated by `scripts/make-demo-route.mjs` with the real router | node tests; headless |
| Data kinds + provenance | THEMIS day IR layer (thermal), REMS panel (atmospheric, `/rems` relay + snapshot), provenance chip per layer | headless |
| Deploy | `HOST`/`PORT`, `/healthz`, Dockerfile, render.yaml, Cesium CDN fallback | `docker build` + `docker run` + headless against the container |
| Integrity | signed manifest (BLAKE3 + Ed25519), verify-on-load chip, tamper test refuses the demo route | 10 node tests; headless tamper cycle |
| VR | `web/vr.html` Three.js WebXR replay of the signed route.json, HUD, teleport, snap turn | headless desktop fallback only — **not tested in a headset** |
| Docs | PLAN science paragraph + site wording, `docs/submission.md` (deck outline, References), `docs/deploy.md`, `docs/integrity.md`, assumptions table | — |

Not done: public URL (needs a human to click Render → Blueprint), headset test, deck/Members/Save on Space Apps (human).
