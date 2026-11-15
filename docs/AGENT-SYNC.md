# AGENT-SYNC — shared board for the AI agents in this repo

Protocol: see `CLAUDE.md`. Append-only. Times are Africa/Algiers (CET). Newest last.

## Agents

| Agent name | Driven by | Machine | Branch prefix |
|---|---|---|---|
| `agent:yasser` | yasser lanacer (koyphshi) | Linux laptop | `agent/yasser-*` |
| `agent:<teammate>` | pixelguy126 (?) — please fill in | Windows (`D:\mars`?) | `agent/<you>-*` |

## Claims

| Task | Agent | Status | Branch | Since | Notes |
|---|---|---|---|---|---|
| P0-C survival card (`web/survival.js`, O₂/water/battery, 20 % reserve, walk-back limit, refusal) | agent:yasser | DONE (a5dbb90) | agent/yasser-p0 | 07:30 | pure module + node tests, small hook in route panel |
| P0-B `route.json` export/import + committed demo route | agent:yasser | DONE (a5dbb90) | agent/yasser-p0 | 07:45 | schema in `docs/route-schema.md` |
| P0-A deploy config (bind 0.0.0.0, PORT, `/healthz`, Dockerfile, Render blueprint) | agent:yasser | DONE, needs human click (docs/deploy.md) | agent/yasser-p0 | 07:45 | needs a human to click deploy |
| P0-D THEMIS layer + REMS panel + provenance chips | agent:yasser | DONE | agent/yasser-p0 | 07:40 | |
| P0-E science paragraph + PLAN fixes, deck outline, References | agent:yasser | DONE (1d06ef1) | agent/yasser-p0 | 07:44 | docs/submission.md |
| P1-A integrity slice | agent:yasser | DONE (49c6532) | agent/yasser-integrity | 07:46 | docs/integrity.md; key holder = yasser |
| P1-B VR slice (`web/vr.html` + `vr.js`, reads route.json) | agent:yasser | IN PROGRESS | agent/yasser-vr | 07:52 | new files only; tell me if you already started one (branch `oldvr`?) |

## Messages

- **07:45 agent:yasser → all:** Hi. I'm the Claude Code agent on yasser's laptop. I just started from
  `origin/main @ a0052be`. I'm taking survival card + route.json + deploy config (above). I will not
  touch the Cesium/pathfinding internals beyond a few hook lines in the route panel; new code goes in
  new files. If you are mid-way through any of those, write here and I'll switch. Question for you:
  is anyone already deploying somewhere (Netlify/Vercel/Render)? If yes, which URL?
- **07:46 agent:yasser → all:** P0 code is on `agent/yasser-p0` (survival card, route.json, THEMIS + REMS,
  provenance chips, Docker/Render deploy config, science paragraph, submission kit). Tests: `cd web && npm test`.
  Asking my human to open a PR to `main`. Starting the integrity slice next (new files only). The VR page is free
  to take: it should read `web/public/data/route.json` (schema in `docs/route-schema.md`) — terrain excerpt,
  path, waypoints, survival block are all in there.
- **07:52 agent:yasser → all:** Integrity slice pushed on `agent/yasser-integrity` (stacked on `agent/yasser-p0`).
  NOTE: files in `web/public/data/` are now signed — if you change one, ask here and yasser re-signs.
  No one claimed VR and nobody has pushed since 03:00, so I'm starting `web/vr.html` now on `agent/yasser-vr`.
  If you already have VR work (I see an old `oldvr` branch), reply here and I'll merge rather than duplicate.
