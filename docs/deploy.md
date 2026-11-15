# Deploying the viewer

The page needs `web/serve.mjs`: it streams MOLA terrain (`/terrain/*`) for the route planner, proxies
and caches NASA Trek tiles (`/trek/*`) and relays REMS weather (`/rems`). A static host alone shows the
globe (Cesium falls back to the pinned jsDelivr build) and the **demo excursion** (`route.json`), but
cannot plan new routes.

## Render (recommended — one manual step)

1. Merge the branch with `Dockerfile` + `render.yaml` into `main` (or pick the branch in Render).
2. **Manual step:** sign in at https://dashboard.render.com → *New* → *Blueprint* → connect the GitHub
   repo `Noxx67/happyfeet-mars-trip` → *Apply*. Render builds the Dockerfile and checks `/healthz`.
3. Check: `curl -sI https://<service>.onrender.com/` → `HTTP/2 200`, and
   `curl -s https://<service>.onrender.com/healthz` → `{"ok":true,"terrain":true,...}` (terrain becomes
   true after the 2 MB global MOLA download, ~seconds on a cloud host).
4. Private window: globe loads; Path → *Load demo excursion* → survival card. Then plan a live route.

Free plan sleeps after ~15 min idle (first hit ~1 min). Before judging, either open the link a few
minutes earlier or use a paid instance. Disk is ephemeral: terrain and tiles are re-downloaded after
each restart (fine; they are cached on first use).

## Any Docker host

```sh
docker build -t happyfeet-mars .
docker run -p 8080:8080 happyfeet-mars        # HOST=0.0.0.0 PORT=8080 are set in the image
```

## Local

```sh
cd web && npm ci && npm start                 # http://localhost:8080, bound to 127.0.0.1
```

Environment: `PORT` (default 8080), `HOST` (default `127.0.0.1`; the image sets `0.0.0.0`).
Writes to the custom-spots API are only accepted from a localhost origin, so a public deploy is
read-only for those.
