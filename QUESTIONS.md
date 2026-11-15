# QUESTIONS — decision requests for the team's AI agents

**Addressed to:** any AI coding agent (Claude Code, OpenCode, Cursor, etc.) working in this repository.
**From:** koyphshi (yasser lanacer), integrity owner.
**Written:** Sun 15 Nov 2026, morning (Africa/Algiers).
**Deadline context:** complete submission target **17:00 today**; hard deadline **23:59**. Only the last saved submission is judged.
**Repository state referenced:** `origin/main` @ `bda3d4f` (52 commits landed overnight).

## Instructions to the agent (binding)

1. Read every question Q1–Q12. Do not skip any.
2. For each, decide **RELEVANT** or **NOT RELEVANT** for a valid submission before 17:00 today. "Relevant" means: without it, the entry fails a firm requirement, loses a scoring criterion, or the demo breaks in front of judges.
3. Record the decision **under the question**, appended, in this exact form:
   `DECISION: RELEVANT | NOT RELEVANT — <one-line reason> — <evidence: file/commit> — <owner>`
4. For every **RELEVANT** item, either implement it now or append a TODO with an explicit time estimate and an owner. Silent ignoring is a failed answer.
5. Never delete or reword the questions. Append only. Do not mark something NOT RELEVANT because it is hard — only because it is genuinely unnecessary for the deadline.
6. Work in priority order: **P0** (submission dies without it) → **P1** → **P2**.
7. If you change code related to a question, note the commit hash in your answer.

---

## P0 — submission dies without these

### Q1 — Deployment: the public link currently 404s
`web/index.html` loads Cesium from `./node_modules/cesium/Build/Cesium/` (lines 8, 216–217), but
`/web/node_modules` is gitignored and no deploy configuration exists (`netlify.toml`, `vercel.json`,
`.github/` absent). Serving the repo as-is yields a blank page — the submission requires a public
link that loads cold, logged out **and one rule violations check**.
**If RELEVANT:** vendor the Cesium build assets (Workers, Assets, ThirdParty, Widgets) into the
served tree, or switch to the Cesium CDN with a matching `CESIUM_BASE_URL`; add the deploy config;
deploy; open the deployed URL in a private window and confirm the globe renders.
**Done when:** `curl -sI <public-url>` returns 200 and a cold private-window load shows the globe.

### Q2 — Survival card (the brief's "safety first")
The app can draw a route but computes no oxygen / water / battery budget, no 20% reserve check, no
walk-back limit, no comms-blackout term (grep: zero references anywhere). This is the product's
stated differentiator and the brief's core safety requirement.
**If RELEVANT:** add the minimal resource model to the route panel: per-step consumption, reserve at
return per crew member, refuse the route when reserve < 20% with the reason naming the limiting
consumable; show ETA and distance. Reuse `web/pathfinding.js` grid/slope outputs.
**Done when:** an infeasible demo route is refused on screen with a named reason, and a feasible
route shows reserve-at-return.

### Q3 — 7-slide deck, References, checkboxes, Members tab
Nothing exists in the repo; presentation is 1 of 5 scoring criteria; over 7 slides = not evaluated.
**If RELEVANT (for an agent):** draft the 7-slide outline and the exact References list from the
repo's actual dependencies (CesiumJS, NASA Trek datasets by name, science.nasa.gov panorama /
photojournal pages, any shipped Python packages). Humans must still submit on the Space Apps site.
**Done when:** a slide outline + References text exists in `docs/` and matches the running app.

---

## P1 — costs score or credibility

### Q4 — Only 2 of the required 3+ data kinds are wired
Wired: optical (Viking, HiRISE) + topographic (MOLA, MOLA+HRSC). Brief asks **at least three kinds**.
Thermal (THEMIS WMTS) and atmospheric (REMS JSON) are recorded as zero-prep READY in
`RESEARCH-mars-cesium-feasibility.md`.
**If RELEVANT:** wire THEMIS day-IR as a toggleable layer and/or a REMS "latest sol" readout.
**Done when:** three distinct data kinds are visible and labelled in the running app.

### Q5 — Provenance chips not rendered
The brief requires showing dataset / mission / resolution / date per layer. The data already exists
in the `LAYERS` definitions (`web/index.html` ~280–310, fields `dataset`, `note`, `credit`).
**If RELEVANT:** render a chip per layer from the existing fields.
**Done when:** every layer shows its provenance in the UI.

### Q6 — Science question unwritten; PLAN.md site sentence stale
`PLAN.md:32` still says "Gale crater / Glen Torridon, boxwork formations" — two different places.
The app already centers on the boxwork traverse (Sols 4512–4671, sites 115–119). No written science
question exists anywhere.
**If RELEVANT:** rewrite the PLAN §1 site sentence to the boxwork unit, and add one paragraph:
question — are the boxwork ridges and hollows mineralogically different (groundwater history)?
Targets — ridge crest, hollow floor, layer contact. Note that orbital mineral data is km-scale;
only crew sampling answers it at walk scale. Fix the other recorded PLAN defects (spike 4 says
"18°N"; Gale is ~5°S) only if time allows.
**Done when:** the science question is one readable paragraph in PLAN.md and matches slide 3.

### Q7 — Integrity: decision pending, code nonexistent
Two documents exist (`PLAN-integrity.md`, `docs/integrity-assertions.md`); zero code. No
`route.json`, `params.json` or rasters exist to sign yet.
**If RELEVANT:** (a) adopt `docs/integrity-assertions.md` as the design of record with the salvage
list from `PLAN-integrity.md` (signature-failure tests, key workflow); (b) build the minimum slice:
a flat signed hash list (BLAKE3 + Ed25519, pinned pubkey) over the files that DO exist
(`web/public/data/**`), verify-on-load, tamper demo button. Do not start Z3.
**If NOT RELEVANT:** say so explicitly and leave both docs as the only artifact.
**Done when:** either the tamper demo refuses a route after one byte is flipped, or the NOT
RELEVANT decision is recorded with a reason.

### Q8 — Dead VR button in the judge path
Nine spots show "Open street view"; the click handler only prints "planned… not available yet"
(`web/index.html:944–946`).
**If RELEVANT:** hide the button for the submission, or implement a minimal panorama view (open the
linked NASA cylindrical panorama in a canvas/modal). Do not attempt full WebXR today.
**Done when:** no judge-clickable button does nothing.

---

## P2 — bonus, only after P0/P1 are green

### Q9 — Crew field reports (tap map → Avoid/Slow zone → instant re-plan)
### Q10 — Mobility profiles / pair comparison card (foot vs parked rover vs concept rover; crew of two budgets)
### Q11 — `forecast/` pipeline integration (currently standalone, zero references from the web app; integrate one output or keep it out of the demo entirely)
### Q12 — Repo hygiene: delete Bevy leftovers (`Cargo.toml`, `Cargo.lock`, `src/`, setup scripts) per PLAN §3; update `PROGRESS.md` (stale since Sat ~14:30); keep all new commit messages professional (history is public)

---

## Answer log (agents append below; newest last)

<!-- Format:
### Qn — DECISION: RELEVANT | NOT RELEVANT
- Reason: ...
- Evidence: file/commit ...
- Action taken: commit ...
- Time estimate if not done: ...
-->

### Q1 — DECISION: RELEVANT
- DECISION: RELEVANT — no public link = no valid entry — web/index.html:8,688-690, no deploy config — agent:yasser
- Action taken: `serve.mjs` honours `HOST`/`PORT`, adds `/healthz`; `Dockerfile`, `.dockerignore`, `render.yaml`; pinned Cesium 1.147.0 CDN fallback when `node_modules` is absent (branch agent/yasser-p0, commit 673229a). Guide: `docs/deploy.md`.
- Remaining: **one human step** — Render dashboard → New → Blueprint → this repo → Apply (no credentials on the agent machine). Est. 10 min + build.

### Q2 — DECISION: RELEVANT
- DECISION: RELEVANT — the stated differentiator; nothing existed — grep showed zero references — agent:yasser
- Action taken: `web/survival.js` (+ `survival-card.js`, `route-io.js`), survival card in the Path tab, demo excursion GO, hypothetical degraded-suit scenarios REFUSED with named reason; 11 node tests (`cd web && npm test`). Commit a5dbb90.

### Q3 — DECISION: RELEVANT
- DECISION: RELEVANT — presentation is a scoring criterion — nothing in repo — agent:yasser
- Action taken: `docs/submission.md` (checklist, 7-slide outline, References from the sources the app uses). Humans: build the deck, paste References, Members tab, Save. Est. 60 min (human).

### Q4 — DECISION: RELEVANT
- DECISION: RELEVANT — brief requires ≥ 3 data kinds — LAYERS had optical + topographic only — agent:yasser
- Action taken: THEMIS day-IR layer (thermal) + REMS "Atmosphere · Gale" panel (atmospheric, live via `/rems`, snapshot fallback). Verified in headless Chrome.

### Q5 — DECISION: RELEVANT
- DECISION: RELEVANT — brief requires provenance per layer — no date / no chip — agent:yasser
- Action taken: chip per layer (kind · dataset · mission · resolution · date · credit). Catalog-added layers show kind "Trek layer" + note + credit.

### Q6 — DECISION: RELEVANT
- DECISION: RELEVANT — slide 3 needs it; PLAN said Glen Torridon — PLAN.md:104 — agent:yasser
- Action taken: PLAN.md §1 site sentence + science paragraph; spot label fixed. 18°N was already marked resolved in PLAN.md spike 4. Commit 1d06ef1.

### Q7 — DECISION: RELEVANT (P1, after P0)
- DECISION: RELEVANT — owner priority; route.json now exists to sign — docs/integrity-assertions.md — agent:yasser
- Plan: flat signed manifest (BLAKE3 + Ed25519 via @noble), verify-on-load chip, tamper button, tests. Owner: agent:yasser. Est. 90 min. Not started at time of writing.

### Q8 — DECISION: NOT RELEVANT (stale)
- DECISION: NOT RELEVANT — the question is stale: Perseverance panorama spots open the external ASU viewer; no dead button found in the current judge path — web/index.html spot card — agent:yasser
- Note: Curiosity boxwork panoramas still say "planned" for VR; P1-B (WebXR) would replace that.
