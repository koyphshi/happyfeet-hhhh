// Minimal local web server for the Mars viewer (no dependencies).
//   - serves this folder at http://localhost:8080
//   - forwards /trek/* to NASA Trek's tile server, so the browser only ever talks
//     to localhost and cross-origin (CORS) rules can't block the Mars imagery.
// Usage: node serve.mjs [--no-open]      (PORT=9000 node serve.mjs to change the port)
import http from "node:http";
import { createReadStream } from "node:fs";
import { stat, mkdir, readFile, writeFile } from "node:fs/promises";
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
  p.endsWith(".png") ? "image/png" : p.endsWith(".jpg") ? "image/jpeg" : "application/octet-stream";
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
    if (upstream.status === 200 && type.startsWith("image/")) {
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
  }
  warmCache().catch((err) => console.warn("Tile warm-up failed:", err.message));
});
