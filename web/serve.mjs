// Minimal local web server for the Mars viewer (no dependencies).
//   - serves this folder at http://localhost:8080
//   - forwards /trek/* to NASA Trek's tile server, so the browser only ever talks
//     to localhost and cross-origin (CORS) rules can't block the Mars imagery.
// Usage: node serve.mjs [--no-open]      (PORT=9000 node serve.mjs to change the port)
import http from "node:http";
import { createReadStream } from "node:fs";
import { stat, mkdir, readFile, writeFile, rename, open, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 8080;
const TREK_TILES = "https://trek.nasa.gov/tiles";
// Trek is slow (2-10 s per tile), so every tile we fetch is kept on disk and served
// instantly next time. Delete the folder to clear it.
const CACHE_DIR = path.join(root, ".tile-cache");

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function send(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

const tileType = (p) =>
  p.endsWith(".png") ? "image/png" : p.endsWith(".jpg") ? "image/jpeg"
  : p.endsWith(".xml") ? "application/xml" : "application/octet-stream";
const inflight = new Map(); // same tile requested twice at once -> one upstream fetch

// Returns { status, body, type }. 200s are cached on disk; 404s are not (cheap to repeat).
async function getTile(rest) {
  const file = path.join(CACHE_DIR, rest);
  try {
    return { status: 200, body: await readFile(file), type: tileType(rest), cached: true };
  } catch {}
  if (inflight.has(rest)) return inflight.get(rest);
  const job = (async () => {
    // Trek sometimes drops connections; retry twice before giving up (502 to the browser).
    let upstream;
    for (let attempt = 1; ; attempt++) {
      try {
        upstream = await fetch(TREK_TILES + rest, { signal: AbortSignal.timeout(30_000) });
        if (upstream.status < 500 || attempt === 3) break;
      } catch (err) {
        if (attempt === 3) throw err;
      }
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    const type = upstream.headers.get("content-type") ?? tileType(rest);
    // images, plus the per-layer WMTSCapabilities.xml (Trek answers missing ones with HTML)
    const keep = type.startsWith("image/") || (rest.endsWith(".xml") && type.includes("xml"));
    if (upstream.status === 200 && keep) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body).catch(() => {});
    }
    return { status: upstream.status, body, type };
  })().finally(() => inflight.delete(rest));
  inflight.set(rest, job);
  return job;
}

async function proxyTrek(url, res) {
  // /trek/Mars/EQ/<layer>/1.0.0/default/default028mm/<z>/<row>/<col>.jpg
  const rest = url.pathname.slice("/trek".length);
  if (!/^\/[A-Za-z0-9_\-./]+$/.test(rest) || rest.includes("..")) {
    return send(res, 400, "Bad tile path");
  }
  try {
    const t = await getTile(rest);
    res.writeHead(t.status, { "Content-Type": t.type, "Cache-Control": t.status === 200 ? "public, max-age=2592000, immutable" : "no-store" });
    res.end(t.body);
  } catch (err) {
    send(res, 502, `Could not reach NASA Trek: ${err.message}`);
  }
}

// Fetch the low-zoom global tiles in the background so the whole planet appears at once
// (levels 0-3 of Viking = 170 tiles, ~8 MB). Runs once; later starts hit the disk cache.
async function warmCache() {
  const base = "/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm";
  const todo = [];
  for (let z = 0; z <= 3; z++)
    for (let y = 0; y < 2 ** z; y++)
      for (let x = 0; x < 2 ** (z + 1); x++) todo.push(`${base}/${z}/${y}/${x}.jpg`);
  let fetched = 0;
  const worker = async () => {
    while (todo.length) {
      const t = await getTile(todo.shift()).catch(() => null);
      if (t && !t.cached) fetched++;
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (fetched) console.log(`Cached ${fetched} global Viking tiles in .tile-cache/`);
}

// ---------------------------------------------------------------- layer catalog
// Every Mars product Trek offers in the equirectangular projection, from Trek's own search
// index. Fetched once a week into .tile-cache/catalog.json and trimmed for the page.
const CATALOG_URL =
  "https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?start=0&rows=5000" +
  "&proj=urn:ogc:def:crs:EPSG::104905";
const CATALOG_FILE = path.join(CACHE_DIR, "catalog.json");
const CATALOG_MAX_AGE = 7 * 24 * 3600 * 1000;
let catalogJob = null;

// Whole-planet layer: all longitudes and at least ±60° latitude (THEMIS stops at ±65°).
// Some index entries carry nonsense extents (east edge past 180°); those are not global.
const isGlobal = ([w, s, e, n]) =>
  w >= -180.5 && e <= 180.5 && e - w >= 350 && s <= -60 && n >= 60;

function trimCatalog(raw) {
  const out = [];
  for (const d of raw.response?.docs ?? []) {
    if (d.itemType !== "product" || !d.productLabel) continue;
    const types = d.serviceTypes ?? [];
    // Feature layers are vector data (points/outlines) without image tiles
    if (types.some((t) => /^Feature/.test(t))) continue;
    const bbox = String(d.bbox ?? "-180,-90,180,90").split(",").map(Number);
    if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v))) continue;
    out.push({
      id: d.productLabel,
      title: d.title ?? d.productLabel,
      cat: d.productCat1 ?? "Other",
      sub: d.productCat2 ?? "",
      mission: d.mission ?? "",
      instrument: d.instrument ?? "",
      bbox,
      // the index's "coverage" field calls many regional mosaics Global; trust the extent
      global: isGlobal(bbox),
      desc: (d.description ?? "").slice(0, 400),
    });
  }
  return out.sort((a, b) => b.global - a.global || a.title.localeCompare(b.title));
}

async function getCatalog() {
  try {
    const info = await stat(CATALOG_FILE);
    if (Date.now() - info.mtimeMs < CATALOG_MAX_AGE) return trimCatalog(JSON.parse(await readFile(CATALOG_FILE, "utf8")));
  } catch {}
  catalogJob ??= (async () => {
    try {
      const r = await fetch(CATALOG_URL, {
        headers: { "User-Agent": "Mozilla/5.0 (mars-viewer)" },
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      const list = trimCatalog(JSON.parse(text));
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(CATALOG_FILE, text).catch(() => {});
      return list;
    } catch (err) { // offline: an old copy is better than nothing
      try { return trimCatalog(JSON.parse(await readFile(CATALOG_FILE, "utf8"))); } catch { throw err; }
    } finally {
      catalogJob = null;
    }
  })();
  return catalogJob;
}

// ---------------------------------------------------------------- terrain (MOLA heights)
// Source: MGS MOLA MEGDR topography from NASA PDS Geosciences, at three resolutions.
// Each is one raw file: big-endian int16, metres above the Mars areoid, line 0 = 90°N,
// sample 0 = 0°E, pixel centres at +0.5. Lines are stored one after another, so any band
// of latitudes is one contiguous byte range: we fetch only the chunks a tile needs (HTTP
// Range), keep them in a sparse file under web/data/, and resume after a restart.
//   4 px/deg  (2 MB)  : fetched whole at startup, serves the global view (levels 0-3)
//  16 px/deg (33 MB)  : fetched on demand for levels 4-5
//  32 px/deg (133 MB) : fetched on demand for levels 6+ (~1.85 km/px)
// While a tile's chunks are missing the server answers 202 and the page keeps showing the
// coarser parent tile until it asks again.
const MEGDR = "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x";
const DATA_DIR = path.join(root, "data");
const TILE_N = 65; // heights per tile edge (64 cells), Cesium's usual heightmap size

// The archive gives ~100 KB/s per connection: at most 6 at once, newest request first,
// so the place on screen now wins over places flown past.
const net = { active: 0, max: 6, stack: [] };
function netRun(fn) {
  return new Promise((resolve, reject) => {
    net.stack.push({ fn, resolve, reject });
    pumpNet();
  });
}
function pumpNet() {
  while (net.active < net.max && net.stack.length) {
    const job = net.stack.pop();
    net.active++;
    job.fn().then(job.resolve, job.reject).finally(() => { net.active--; pumpNet(); });
  }
}

class LazyDem {
  constructor({ dir, file, ppd, chunk }) {
    this.url = `${MEGDR}/${dir}/${file}`;
    this.file = path.join(DATA_DIR, file);
    this.part = this.file + ".part";
    this.doneFile = this.part + ".json"; // indices of chunks already in .part
    this.ppd = ppd;
    this.w = 360 * ppd;
    this.h = 180 * ppd;
    this.bytes = this.w * this.h * 2;
    this.chunk = chunk; // even, so a chunk never splits a sample
    this.nChunks = Math.ceil(this.bytes / chunk);
    this.data = new Int16Array(this.w * this.h);
    this.done = new Set();
    this.pending = new Map(); // chunk index -> promise
    this.saving = Promise.resolve();
    this.fh = null;
  }

  get complete() { return this.done.size === this.nChunks; }
  get progress() { return this.done.size / this.nChunks; }

  decode(buf, byteOffset) {
    const base = byteOffset / 2;
    for (let i = 0; i < buf.length; i += 2) this.data[base + i / 2] = buf.readInt16BE(i);
  }

  async init() {
    await mkdir(DATA_DIR, { recursive: true });
    try { // already fully downloaded
      const raw = await readFile(this.file);
      if (raw.length === this.bytes) {
        this.decode(raw, 0);
        for (let i = 0; i < this.nChunks; i++) this.done.add(i);
        return;
      }
    } catch {}
    try { this.done = new Set(JSON.parse(await readFile(this.doneFile, "utf8"))); } catch {}
    if (this.done.size) {
      try {
        const raw = await readFile(this.part);
        for (const i of this.done) {
          const start = i * this.chunk, end = Math.min(this.bytes, start + this.chunk);
          if (raw.length < end) { this.done.delete(i); continue; }
          this.decode(raw.subarray(start, end), start);
        }
        this.fh = await open(this.part, "r+");
      } catch {
        this.done.clear();
      }
    }
    if (!this.fh) this.fh = await open(this.part, "w");
    if (this.done.size) console.log(`MOLA ${this.ppd} px/deg: ${Math.round(this.progress * 100)}% cached`);
  }

  // Chunk indices covering DEM lines r0..r1 that are not on disk yet.
  missing(r0, r1) {
    const c0 = Math.floor((r0 * this.w * 2) / this.chunk);
    const c1 = Math.floor(((r1 + 1) * this.w * 2 - 1) / this.chunk);
    const out = [];
    for (let i = c0; i <= c1; i++) if (!this.done.has(i)) out.push(i);
    return out;
  }

  ensureChunk(i) {
    if (this.done.has(i)) return Promise.resolve();
    if (this.pending.has(i)) return this.pending.get(i);
    const p = netRun(() => this.fetchChunk(i))
      .then(() => {
        this.done.add(i);
        this.saving = this.saving.then(() => this.save()).catch(() => {});
      })
      .finally(() => this.pending.delete(i));
    this.pending.set(i, p);
    return p;
  }

  async fetchChunk(i) {
    const start = i * this.chunk, end = Math.min(this.bytes, start + this.chunk) - 1;
    for (let attempt = 1; ; attempt++) {
      try {
        // the archive refuses requests without a browser-like User-Agent
        const r = await fetch(this.url, {
          headers: { "User-Agent": "Mozilla/5.0 (mars-viewer)", Range: `bytes=${start}-${end}` },
          signal: AbortSignal.timeout(120_000),
        });
        if (r.status !== 206) throw new Error(`HTTP ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length !== end - start + 1) throw new Error(`short chunk ${buf.length}`);
        await this.fh.write(buf, 0, buf.length, start);
        this.decode(buf, start);
        return;
      } catch (err) {
        if (attempt >= 5) {
          console.warn(`MOLA ${this.ppd} px/deg chunk ${i} failed: ${err.message}`);
          throw err;
        }
        await new Promise((res) => setTimeout(res, 1000 * attempt));
      }
    }
  }

  async save() {
    if (!this.fh) return;
    if (!this.complete) return writeFile(this.doneFile, JSON.stringify([...this.done]));
    const fh = this.fh;
    this.fh = null;
    await fh.close();
    await rename(this.part, this.file);
    await rm(this.doneFile, { force: true });
    console.log(`MOLA ${this.ppd} px/deg fully cached.`);
  }

  // DEM line range touched by bilinear sampling between two latitudes.
  rows(north, south) {
    const clamp = (v) => Math.min(this.h - 1, Math.max(0, v));
    return [
      clamp(Math.floor((90 - north) * this.ppd - 0.5)),
      clamp(Math.floor((90 - south) * this.ppd - 0.5) + 1),
    ];
  }

  // Bilinear height (m) at a planetocentric lat/lon (lon -180..180 or 0..360).
  height(lat, lon) {
    const { data, w, h, ppd } = this;
    const sx = (((lon % 360) + 360) % 360) * ppd - 0.5;
    const sy = Math.min(h - 1, Math.max(0, (90 - lat) * ppd - 0.5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    const fx = sx - x0, fy = sy - y0;
    const xa = (x0 + w) % w, xb = (x0 + 1) % w; // wraps at the 0/360° seam
    const ya = y0, yb = Math.min(h - 1, y0 + 1);
    const h00 = data[ya * w + xa], h10 = data[ya * w + xb];
    const h01 = data[yb * w + xa], h11 = data[yb * w + xb];
    return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
  }
}

const DEMS = [
  new LazyDem({ dir: "meg004", file: "megt90n000cb.img", ppd: 4, chunk: 256 * 1024 }),
  new LazyDem({ dir: "meg016", file: "megt90n000eb.img", ppd: 16, chunk: 1024 * 1024 }),
  // 2 MB chunks: same layout as the old whole-file download, so a half-finished one is reused
  new LazyDem({ dir: "meg032", file: "megt90n000fb.img", ppd: 32, chunk: 2 * 1024 * 1024 }),
];
const terrain = { ready: false, error: null };

// Coarsest DEM that still has at least one sample per tile cell at this level.
function demFor(level) {
  const cellsPerDeg = ((TILE_N - 1) * 2 ** level) / 180;
  return DEMS.find((d) => d.ppd >= cellsPerDeg) ?? DEMS[DEMS.length - 1];
}

async function loadTerrain() {
  for (const d of DEMS) await d.init();
  const base = DEMS[0];
  if (!base.complete) {
    console.log("Fetching global MOLA elevation (2 MB)…");
    await Promise.all(Array.from({ length: base.nChunks }, (_, i) => base.ensureChunk(i)));
  }
  terrain.ready = true;
  console.log("MOLA terrain ready (finer detail is fetched as you zoom in).");
}

// /terrain/{z}/{x}/{y}  ->  65x65 little-endian float32 heights, row 0 = north edge (67x67 with ?b=1).
// Same tiling as the imagery: geographic, 2 x 1 tiles at level 0.
// 202 = this tile's data is being fetched, ask again shortly.
function serveTerrain(url, res) {
  // /terrain/point?lat=&lon=  ->  { height, ppd } from the finest DEM that has this spot on
  // disk; the 32 px/deg chunk is fetched in the background so the next click there is exact.
  if (url.pathname === "/terrain/point") {
    const lat = Number(url.searchParams.get("lat")), lon = Number(url.searchParams.get("lon"));
    if (!terrain.ready || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90)
      return send(res, terrain.ready ? 400 : 503, "lat/lon needed");
    let best = DEMS[0];
    for (const d of DEMS) {
      const miss = d.missing(...d.rows(lat, lat));
      if (!miss.length) best = d;
      else if (d === DEMS[DEMS.length - 1]) for (const i of miss) d.ensureChunk(i).catch(() => {});
    }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({ height: Math.round(best.height(lat, lon)), ppd: best.ppd }));
  }
  if (url.pathname === "/terrain/status") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({
      ready: terrain.ready,
      progress: DEMS[0].progress,
      error: terrain.error,
      cached: Object.fromEntries(DEMS.map((d) => [d.ppd, d.progress])),
    }));
  }
  const m = /^\/terrain\/(\d{1,2})\/(\d{1,8})\/(\d{1,8})$/.exec(url.pathname);
  if (!m) return send(res, 400, "Bad terrain path");
  if (!terrain.ready) return send(res, 503, "Terrain not ready yet");
  const [z, x, y] = m.slice(1).map(Number);
  const nx = 2 ** (z + 1), ny = 2 ** z;
  if (z > 22 || x >= nx || y >= ny) return send(res, 404, "No such tile");
  const dLon = 360 / nx, dLat = 180 / ny;
  const west = -180 + x * dLon, north = 90 - y * dLat;

  // ?b=1 adds a one-sample border on every side ((TILE_N + 2)^2 heights), so the page can
  // compute surface normals at tile edges that match the neighbouring tile's.
  const border = url.searchParams.get("b") === "1" ? 1 : 0;
  const n = TILE_N + 2 * border, step = dLat / (TILE_N - 1);

  const dem = demFor(z);
  const missing = dem.missing(...dem.rows(north + border * step, north - dLat - border * step));
  if (missing.length) {
    for (const i of missing) dem.ensureChunk(i).catch(() => {});
    res.writeHead(202, { "Content-Type": "text/plain", "Cache-Control": "no-store", "Retry-After": "1" });
    return res.end(`fetching ${missing.length} chunk(s)`);
  }

  const out = new Float32Array(n * n);
  for (let r = 0; r < n; r++) {
    const lat = Math.max(-90, Math.min(90, north - ((r - border) / (TILE_N - 1)) * dLat));
    for (let c = 0; c < n; c++) out[r * n + c] = dem.height(lat, west + ((c - border) / (TILE_N - 1)) * dLon);
  }
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Cache-Control": "public, max-age=2592000, immutable",
  });
  res.end(Buffer.from(out.buffer));
}

async function serveFile(url, res) {
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, "Bad URL");
  }
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(root, rel));
  if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, "Forbidden");

  let info;
  try {
    info = await stat(file);
  } catch {
    return send(res, 404, "Not found");
  }
  if (!info.isFile()) return send(res, 404, "Not found");

  res.writeHead(200, {
    "Content-Type": types[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": info.size,
  });
  createReadStream(file)
    .on("error", () => res.destroy())
    .pipe(res);
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/__proxy") return send(res, 200, "ok"); // lets the page detect this server
  if (url.pathname === "/catalog") {
    return getCatalog().then(
      (list) => {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(list));
      },
      (err) => send(res, 502, `Could not load the Trek catalog: ${err.message}`),
    );
  }
  if (url.pathname.startsWith("/terrain/")) {
    try { return serveTerrain(url, res); } catch (err) { return send(res, 500, String(err)); }
  }
  const job = url.pathname.startsWith("/trek/") ? proxyTrek(url, res) : serveFile(url, res);
  job.catch((err) => send(res, 500, String(err)));
});

server.on("error", (err) => {
  console.error(
    err.code === "EADDRINUSE"
      ? `Port ${port} is already in use. Close the other server, or run with PORT=9000.`
      : err,
  );
  process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
  const url = `http://localhost:${port}/`;
  console.log(`Mars viewer running at ${url}  (Ctrl+C to stop)`);
  if (process.platform === "win32" && !process.argv.includes("--no-open")) {
    exec(`start "" "${url}"`);
  } else if (process.platform === "linux" && !process.argv.includes("--no-open")) {
    exec(`xdg-open "${url}"`, (err) => {
      if (err) console.log(`Open ${url} in your browser.`);
    });
  }
  warmCache().catch((err) => console.warn("Tile warm-up failed:", err.message));
  loadTerrain().catch((err) => {
    terrain.error = err.message;
    console.warn("Terrain unavailable (the map still works, flat):", err.message);
  });
});
