// Minimal local web server for the Mars viewer (no dependencies).
//   - serves this folder at http://localhost:8080
//   - forwards /trek/* to NASA Trek's tile server, so the browser only ever talks
//     to localhost and cross-origin (CORS) rules can't block the Mars imagery.
// Usage: node serve.mjs [--no-open]      (PORT=9000 node serve.mjs to change the port)
import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 8080;
const TREK_TILES = "https://trek.nasa.gov/tiles";

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

async function proxyTrek(url, res) {
  // /trek/Mars/EQ/<layer>/1.0.0/default/default028mm/<z>/<row>/<col>.jpg
  const rest = url.pathname.slice("/trek".length);
  if (!/^\/[A-Za-z0-9_\-./]+$/.test(rest) || rest.includes("..")) {
    return send(res, 400, "Bad tile path");
  }
  try {
    const upstream = await fetch(TREK_TILES + rest);
    const body = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Cache-Control": "public, max-age=86400",
    });
    res.end(body);
  } catch (err) {
    send(res, 502, `Could not reach NASA Trek: ${err.message}`);
  }
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
});
