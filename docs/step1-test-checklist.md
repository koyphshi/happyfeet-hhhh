# Step 1 test checklist — Mars globe with Gale imagery (P0 #1)

Changed file: `web/index.html` (the old one is in git history: `git checkout -- web/index.html` restores it).
Also changed (14 Nov, "planet not showing" fix): `web/serve.mjs` now caches Trek tiles on disk in
`web/.tile-cache/` (git-ignored), retries failed fetches, and pre-fetches the global Viking tiles at start.

**Run by Claude in headless Chrome (14 Nov):** tests 1–3 pass: globe appears in ~3 s, auto-flies to Gale,
HiRISE fully sharp after ~25 s on a cold cache, no tile errors. Tests 4–9 still need a human.

**Why the planet didn't show before:** NASA Trek takes 2–10 s per tile. The page flew to Gale after 0.8 s,
which cancelled the global tiles, so you saw a bare brown ball for a long time. Now the page waits for the
planet to finish painting (max 10 s) before flying, and shows "Loading Mars tiles… N left".

## How to run

1. Windows: open the project folder. Linux: from the project root run `./start-viewer.sh` (first run installs npm dependencies).
2. If Cesium is missing, run `npm install` in the `web` folder.
3. Windows: run `start-viewer.bat`. Linux: run `./start-viewer.sh`. Both serve http://localhost:8080.
4. Open the browser console (F12) and keep it visible while testing.

## Tests

| # | Do | Expect |
|---|---|---|
| 1 | Load the page | A reddish globe, not a blue Earth. No "Cesium did not load" message. |
| 2 | Wait for the initial flight | The camera selects the Gale boxwork target, highlights its marker, opens its info card, and ends looking straight down at about 18 km altitude. |
| 3 | At Gale | Sharp high-resolution imagery (the Gale HiRISE mosaic) fills the view, no grey or empty squares inside it. |
| 4 | Untick "Gale HiRISE mosaic" | Imagery drops to the coarser Viking colours. Tick it again and it returns. |
| 5 | Tick "MOLA + HRSC colour relief", drag its opacity slider | A rainbow elevation layer fades in and out over the imagery. Repeat for "MOLA colour relief". |
| 6 | Zoom and drag around Mars, then select a mission spot | Globe navigation remains available and selecting the spot flies to its marker. |
| 7 | Inspect a spot outside Gale, such as Perseverance | Only the global layers show (no Gale mosaic there). This is expected. |
| 8 | Zoom out and look at the whole planet | Slightly flattened sphere (poles ~20 km closer than the equator). You will not see it by eye; this checks nothing crashes. |
| 9 | Look at the bottom of the window | Credits line shows the Viking and HiRISE source credits. Do not hide it. |
| 10 | Select a mission spot from the list, then click its map marker | The camera zooms to it and an anchored stats card shows coordinates, MOLA elevation, distance from Gale, HiRISE coverage, and a source link. Marker labels appear only for the selected spot. |
| 11 | Select the Gale boxwork target | The card identifies it as an approximate regional target rather than an exact rover position. |
| 12 | Search for “Gale”, choose a category, and select a tag | The list and visible map markers filter together; the match count updates. |
| 13 | Select a Gale boxwork panorama | A regular NASA/JPL boxwork close-up appears on the card with its own photo credit link; Sol, site, drive, heading, category, tags, panorama source, and placeholder street-view button are also shown. |
| 14 | Search/filter for “Panorama” and select several adjacent Gale panorama markers | Eight Curiosity Navcam panoramas appear along one ~1.5 km traverse cluster (sites 115–119); each uses the nearby Sol 4636 boxwork close-up and has its own NASA panorama source link and VR placeholder button. |

## If something fails

| Symptom | Likely cause | Try |
|---|---|---|
| "Cesium did not load" | `node_modules/cesium` missing | `npm install cesium` in `web/` |
| Brown/empty globe for a long time | Opened the HTML without `serve.mjs`, so tiles come straight from slow Trek | Use `start-viewer.bat` or `./start-viewer.sh`. The proxy is used automatically; `?direct` forces direct Trek requests |
| Brown/empty globe, console shows 404 | A layer name or zoom limit is wrong | Copy the failing URL into the address bar and tell me which dataset it is |
| Gale imagery blurry at 20 km | Tiles stop at zoom 16 (about 0.6 m/px) | Expected; see below |
| Page works with `?proxy` but not without | Trek does not send CORS headers for that layer | Report it. It changes the hosting plan, because a static site cannot proxy |

## What was verified (live, 2026-11-14)

- All four tile URLs return 200 at Gale for several zoom levels, with the expected format.
- Maximum zoom, by testing the next level (404): Viking 7, MOLA 463 m 7, MOLA/HRSC 200 m 8, Gale HiRISE 16.
- The old `index.html` used `Viking_MDIM21_ClrMosaic_global_232m` (no `Mars_` prefix); that returns 404. Fixed here.
- Not verified: how the page renders; whether Trek sends CORS headers to localhost.

## Findings that affect the plan

- The Gale WMTS tiles stop at zoom 16, about 0.64 m per pixel. `PLAN.md` quotes 0.25 m for Gale optical via
  `exportImage`. True 25 cm needs `exportImage`; the tile layer is the quick, cacheable version.
- The 3D relief is not here. MOLA appears as a coloured picture, not as terrain height. Real terrain needs the
  DEM work in the spikes.

## Not in this step

Layer provenance chips, POI markers, the planner, and everything else on the ladder. Next in order is
P0 #2 (provenance chips) and the spikes.
