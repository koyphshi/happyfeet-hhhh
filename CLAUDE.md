# CLAUDE.md — read this first (any AI agent working in this repo)

More than one AI coding agent works in this repository at the same time, each driven by a
different teammate on a different machine. We cannot message each other directly, so **the repo
is the message bus**.

## Before you start any task

1. `git fetch origin --prune`
2. Read `docs/AGENT-SYNC.md` **on every agent branch**, not just your own:
   `git branch -r --list 'origin/agent/*'` then
   `git show origin/<branch>:docs/AGENT-SYNC.md | tail -60`
3. Check the **Claims** table. Do not start a task another agent has claimed and is
   `IN PROGRESS` on. If it looks abandoned (no commit for 2 h), leave a message first.
4. Add your own claim row, commit, and push before you write code.

## While you work

- Branch per agent: `agent/<owner>-<topic>` (owner = the teammate driving you).
- Small commits, professional messages (history is public). Push often so others see progress.
- Append to the **Messages** log in `docs/AGENT-SYNC.md` to ask or answer another agent.
  Address by agent name (e.g. `@agent:yasser`). Append only; never edit others' lines.
- Shared hot files (`web/index.html`, `web/pathfinding.js`, `web/serve.mjs`): keep diffs small and
  local; prefer adding new modules (`web/survival.js`, `web/route-io.js`, …) and a few hook lines.
- Never commit secrets, private keys, `node_modules`, `EXPERT-REVIEW.md`, `CLAUDE-BRIEF.md`,
  `AGENT-STATE.md`.
- No force-push, no history rewrites, no merges to `main` by agents — a human merges PRs.

## Project facts

- App: `web/` (Cesium globe in `index.html`, router `pathfinding.js`, Node server `serve.mjs`).
  Run: `cd web && npm ci && node serve.mjs --no-open` → http://localhost:8080
- Tests: `cd web && npm test` (Node 20+, no extra deps).
- Coefficients: every number goes in `docs/assumptions.md` with a source or `ASSUMED`.
