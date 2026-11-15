// Local, terrain-only Theta* over numeric MOLA height tiles served by serve.mjs.
// Trek's MOLA/HRSC relief layer is color imagery; these heights come from numeric MOLA.
const TILE_CELLS = 64;
const TILE_SAMPLES = TILE_CELLS + 1;
const MARS_RADIUS_M = 3_396_190;

function tileColumns(level) { return 2 ** (level + 1); }
function tileRows(level) { return 2 ** level; }
function lonTile(lon, level) {
  const n = tileColumns(level), d = 360 / n;
  let normalized = ((lon + 180) % 360 + 360) % 360;
  return Math.min(n - 1, Math.floor(normalized / d));
}
function latTile(lat, level) {
  const n = tileRows(level), d = 180 / n;
  return Math.max(0, Math.min(n - 1, Math.floor((90 - lat) / d)));
}

export function estimateTerrainPatchCells(bounds, level = 6) {
  const dLat = 180 / tileRows(level);
  const westX = lonTile(bounds.west, level), eastX = lonTile(bounds.east - 1e-10, level);
  const nx = bounds.west <= bounds.east
    ? eastX - westX + 1
    : tileColumns(level) - westX + eastX + 1;
  const y0 = latTile(bounds.north, level);
  const y1 = Math.max(0, Math.min(tileRows(level) - 1, Math.floor((90 - bounds.south - 1e-10) / dLat)));
  return (nx * TILE_CELLS + 1) * ((y1 - y0 + 1) * TILE_CELLS + 1);
}

// onWait(true) the first time the server answers 202 ("still downloading this data"),
// onWait(false) once the tile arrives; used for the route planner's progress report.
async function fetchHeightTile(z, x, y, signal, onWait) {
  let waited = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    const response = await fetch(`/terrain/${z}/${x}/${y}`, { signal, cache: "force-cache" });
    if (response.status === 202) {
      if (!waited) { waited = true; onWait?.(true); }
      const delay = Number(response.headers.get("Retry-After") || 1);
      await new Promise((resolve, reject) => {
        const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
        const timer = setTimeout(finish, delay * 1000);
        const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal.reason); };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
      continue;
    }
    if (!response.ok) throw new Error(`MOLA height tile ${z}/${x}/${y}: HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== TILE_SAMPLES * TILE_SAMPLES * 4)
      throw new Error(`MOLA height tile ${z}/${x}/${y}: unexpected byte count`);
    if (waited) onWait?.(false);
    return new Float32Array(bytes);
  }
  throw new Error(`MOLA height tile ${z}/${x}/${y} is still being prepared`);
}

// Fetch many tiles at once and report onProgress({ done, total, preparing, level }):
// preparing = tiles the server is still downloading source data for (it answered 202).
async function fetchTiles(level, list, signal, onProgress) {
  let done = 0, preparing = 0;
  const report = () => onProgress?.({ done, total: list.length, preparing, level });
  report();
  return Promise.all(list.map(async ([tx, ty]) => {
    const data = await fetchHeightTile(level, tx, ty, signal, (w) => { preparing += w ? 1 : -1; report(); });
    done++; report();
    return data;
  }));
}

// Bounds are Mars longitude/latitude degrees. Keep the patch local; the source data is
// fetched only for intersecting Cesium tiles and no whole-planet raster is built.
export async function loadTerrainPatch({ west, south, east, north, level = 6, signal, maxCells = 4_000_000, onProgress }) {
  if (![west, south, east, north].every(Number.isFinite) || south >= north ||
      west < -180 || east > 180 || south < -90 || north > 90)
    throw new RangeError("Expected Mars bounds; west > east is allowed across the longitude seam");
  if (!Number.isInteger(level) || level < 0 || level > 22) throw new RangeError("Invalid terrain level");

  const tilesX = tileColumns(level), tilesY = tileRows(level);
  const tileLon = 360 / tilesX, tileLat = 180 / tilesY;
  const tileX = (lon) => Math.max(0, Math.min(tilesX - 1, Math.floor((lon + 180) / tileLon)));
  const x0 = tileX(west);
  const x1 = tileX(east - 1e-10);
  const xs = west <= east
    ? Array.from({ length: x1 - x0 + 1 }, (_, i) => x0 + i)
    : [...Array.from({ length: tilesX - x0 }, (_, i) => x0 + i), ...Array.from({ length: x1 + 1 }, (_, i) => i)];
  const y0 = Math.max(0, Math.floor((90 - north) / tileLat));
  const y1 = Math.min(tilesY - 1, Math.floor((90 - south - 1e-10) / tileLat));
  const nx = xs.length, ny = y1 - y0 + 1;
  const width = nx * TILE_CELLS + 1, height = ny * TILE_CELLS + 1;
  if (width * height > maxCells)
    throw new RangeError(`Terrain patch is too large (${width}×${height}); narrow the route area or lower level`);

  const tiles = await fetchTiles(level,
    Array.from({ length: nx * ny }, (_, i) => [xs[i % nx], y0 + Math.floor(i / nx)]), signal, onProgress);
  const heights = new Float32Array(width * height);
  for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
    const tile = tiles[ty * nx + tx];
    for (let r = 0; r < TILE_SAMPLES; r++) {
      const dst = (ty * TILE_CELLS + r) * width + tx * TILE_CELLS;
      heights.set(tile.subarray(r * TILE_SAMPLES, r * TILE_SAMPLES + TILE_SAMPLES), dst);
    }
  }

  return {
    width, height, heights,
    westDeg: -180 + xs[0] * tileLon,
    northDeg: 90 - y0 * tileLat,
    lonStepDeg: tileLon / TILE_CELLS,
    latStepDeg: -tileLat / TILE_CELLS,
    level,
    source: "NASA MGS MOLA numeric topography via PDS; streamed by local terrain service",
  };
}

// Load only fine tiles touched by a coarse route and a one-tile buffer around it.
// The returned sparse grid lets fine Theta* explore only this local corridor.
export async function loadTerrainCorridor(coarsePath, { level = 6, bufferTiles = 1, maxTiles = 256, signal, onProgress } = {}) {
  if (!coarsePath?.length) throw new RangeError("A coarse route is required");
  if (!Number.isInteger(bufferTiles) || bufferTiles < 0) throw new RangeError("Invalid tile buffer");
  const nx = tileColumns(level), ny = tileRows(level), keys = new Set();
  for (const p of coarsePath) {
    const cx = lonTile(p.lon, level), cy = latTile(p.lat, level);
    for (let oy = -bufferTiles; oy <= bufferTiles; oy++) {
      const y = cy + oy;
      if (y < 0 || y >= ny) continue;
      for (let ox = -bufferTiles; ox <= bufferTiles; ox++) {
        const x = (cx + ox + nx) % nx;
        keys.add(`${x},${y}`);
      }
    }
  }
  if (keys.size > maxTiles)
    throw new RangeError(`Detailed route corridor needs ${keys.size} tiles (limit ${maxTiles})`);

  const coords = [...keys].map((key) => key.split(",").map(Number));
  const datas = await fetchTiles(level, coords, signal, onProgress);
  const tiles = coords.map(([x, y], i) => ({ x, y, data: datas[i] }));
  const worldWidth = nx * TILE_CELLS, worldHeight = ny * TILE_CELLS;
  const heights = new Map();
  for (const { x, y, data } of tiles) {
    for (let r = 0; r < TILE_SAMPLES; r++) {
      const gy = y * TILE_CELLS + r;
      for (let c = 0; c < TILE_SAMPLES; c++) {
        const gx = (x * TILE_CELLS + c) % worldWidth;
        heights.set(gy * worldWidth + gx, data[r * TILE_SAMPLES + c]);
      }
    }
  }
  return {
    width: worldWidth, height: worldHeight + 1, heights, wrapX: true,
    tileKeys: [...keys].map((key) => key.split(",").map(Number)),
    westDeg: -180, northDeg: 90,
    lonStepDeg: 360 / worldWidth, latStepDeg: -180 / worldHeight,
    level,
    source: "NASA MGS MOLA numeric topography via PDS; sparse fine tile corridor",
  };
}

export function lonLatToTerrainCell(grid, lonDeg, latDeg) {
  let lon = lonDeg;
  while (lon < grid.westDeg) lon += 360;
  while (lon >= grid.westDeg + grid.width * grid.lonStepDeg) lon -= 360;
  const x = Math.round((lon - grid.westDeg) / grid.lonStepDeg);
  const y = Math.round((latDeg - grid.northDeg) / grid.latStepDeg);
  if (x < 0 || x >= grid.width || y < 0 || y >= grid.height) return null;
  return { x, y };
}

export function terrainCellSlopeDeg(grid, x, y) {
  const { width, height, heights, wrapX, westDeg, northDeg, lonStepDeg, latStepDeg } = grid;
  const get = (xx, yy) => {
    if (wrapX) xx = (xx + width) % width;
    if (xx < 0 || xx >= width || yy < 0 || yy >= height) return undefined;
    const id = yy * width + xx;
    return heights instanceof Map ? heights.get(id) : heights[id];
  };
  const h = get(x, y);
  if (h === undefined) return Infinity;
  const radians = Math.PI / 180;
  const lat = (northDeg + y * latStepDeg) * radians;
  const horizontal = (dx, dy) => Math.hypot(dx * lonStepDeg * radians * MARS_RADIUS_M * Math.cos(lat),
    dy * latStepDeg * radians * MARS_RADIUS_M);
  const derivative = (a, b, da, db) => {
    if (a !== undefined && b !== undefined) return (b - a) / (da + db);
    if (b !== undefined) return (b - h) / db;
    if (a !== undefined) return (h - a) / da;
    return undefined;
  };
  const west = get(x - 1, y), east = get(x + 1, y), north = get(x, y - 1), south = get(x, y + 1);
  const dx = derivative(west, east, horizontal(-1, 0), horizontal(1, 0));
  const dy = derivative(north, south, horizontal(0, -1), horizontal(0, 1));
  if (dx === undefined || dy === undefined) return Infinity;
  return Math.atan(Math.hypot(dx, dy)) / radians;
}

// Weighted Basic Theta*: any-angle shortcuts are checked against the same cell slope
// mask as the overlay, while edge grades retain the configured climb limit.
export async function planTerrainRoute(grid, start, goal, { maxSlopeDeg = Infinity, signal, shouldCancel = () => false, onProgress } = {}) {
  if (!(maxSlopeDeg === Infinity || (Number.isFinite(maxSlopeDeg) && maxSlopeDeg >= 0 && maxSlopeDeg < 90)))
    throw new RangeError("maxSlopeDeg must be between 0 and 90 degrees");
  const { width, height, heights, westDeg, northDeg, lonStepDeg, latStepDeg } = grid;
  const sparse = heights instanceof Map;
  if (!sparse && (!(heights instanceof Float32Array) || heights.length !== width * height))
    throw new TypeError("heights must be a matching Float32Array or sparse Map");
  const inBounds = (p) => Number.isInteger(p.x) && Number.isInteger(p.y) &&
    p.x >= 0 && p.x < width && p.y >= 0 && p.y < height;
  if (!inBounds(start) || !inBounds(goal)) throw new RangeError("start/goal outside terrain patch");

  const index = (p) => p.y * width + p.x;
  const startId = index(start), goalId = index(goal);
  const heightAt = (id) => sparse ? heights.get(id) : heights[id];
  if (heightAt(startId) === undefined || heightAt(goalId) === undefined) return null;
  const radians = Math.PI / 180;
  const pos = (x, y) => ({
    lat: (northDeg + y * latStepDeg) * radians,
    lon: (westDeg + x * lonStepDeg) * radians,
  });
  const horizontal = (x0, y0, x1, y1) => {
    const a = pos(x0, y0), b = pos(x1, y1), midLat = (a.lat + b.lat) / 2;
    let dLon = b.lon - a.lon;
    if (dLon > Math.PI) dLon -= 2 * Math.PI;
    else if (dLon < -Math.PI) dLon += 2 * Math.PI;
    const east = dLon * MARS_RADIUS_M * Math.cos(midLat);
    const north = (b.lat - a.lat) * MARS_RADIUS_M;
    return Math.hypot(east, north);
  };
  const maxSlopeRatio = Math.tan(maxSlopeDeg * radians);
  const heuristic = (p) => {
    const a = pos(p.x, p.y), b = pos(goal.x, goal.y);
    let dLon = b.lon - a.lon;
    if (dLon > Math.PI) dLon -= 2 * Math.PI;
    else if (dLon < -Math.PI) dLon += 2 * Math.PI;
    const dLat = b.lat - a.lat;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat) * Math.cos(b.lat) * Math.sin(dLon / 2) ** 2;
    return 2 * MARS_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, h)));
  };
  const g = new Map([[startId, 0]]), parent = new Map(), closed = new Set(), slopeCache = new Map();
  const cellSlope = (id) => {
    if (!slopeCache.has(id)) slopeCache.set(id, terrainCellSlopeDeg(grid, id % width, Math.floor(id / width)));
    return slopeCache.get(id);
  };

  // Binary min-heap, ordered by estimated total terrain distance.
  const heap = [];
  const push = (item) => {
    let i = heap.length; heap.push(item);
    while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= item[0]) break; heap[i] = heap[p]; i = p; }
    heap[i] = item;
  };
  const pop = () => {
    const first = heap[0], last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (true) {
        let c = i * 2 + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++;
        if (heap[c][0] >= last[0]) break;
        heap[i] = heap[c]; i = c;
      }
      heap[i] = last;
    }
    return first;
  };

  const rasterLine = (from, to) => {
    let x0 = from % width, y0 = Math.floor(from / width), x1 = to % width, y1 = Math.floor(to / width);
    if (grid.wrapX && Math.abs(x1 - x0) > width / 2) x1 += x1 < x0 ? width : -width;
    const line = [], dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      line.push((y0 * width) + ((x0 % width + width) % width));
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return line;
  };
  const segment = (from, to) => {
    const line = rasterLine(from, to);
    let cost = 0;
    for (let i = 0; i < line.length; i++) {
      if (cellSlope(line[i]) > maxSlopeDeg) return null;
      if (!i) continue;
      const a = line[i - 1], b = line[i], ax = a % width, ay = Math.floor(a / width), bx = b % width, by = Math.floor(b / width);
      const ha = heightAt(a), hb = heightAt(b);
      if (ha === undefined || hb === undefined) return null;
      const d = horizontal(ax, ay, bx, by), rise = Math.abs(hb - ha);
      if (rise > d * maxSlopeRatio) return null;
      cost += Math.hypot(d, rise);
    }
    return { cost, line };
  };
  if (cellSlope(startId) > maxSlopeDeg || cellSlope(goalId) > maxSlopeDeg) return null;
  push([heuristic(start), 0, startId]);
  const moves = [[-1,-1], [0,-1], [1,-1], [-1,0], [1,0], [-1,1], [0,1], [1,1]];
  let expanded = 0;
  while (heap.length) {
    if (signal?.aborted || shouldCancel()) return null;
    if (++expanded % 128 === 0) {
      if (expanded % 4096 === 0) onProgress?.({ expanded });
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (signal?.aborted || shouldCancel()) return null;
    }
    const [, currentCost, id] = pop();
    if (closed.has(id) || currentCost !== g.get(id)) continue;
    if (id === goalId) {
      const anchors = [];
      for (let at = id; at !== undefined; at = parent.get(at)) anchors.push(at);
      anchors.reverse();
      const ids = [];
      const displayPath = [];
      const turnIndices = [];
      for (let i = 1; i < anchors.length; i++) {
        const from = anchors[i - 1], to = anchors[i], line = segment(from, to).line;
        if (i > 1) turnIndices.push(displayPath.length - 1);
        ids.push(...line.slice(ids.length ? 1 : 0));
        const ax = from % width, ay = Math.floor(from / width);
        let bx = to % width;
        const by = Math.floor(to / width);
        if (grid.wrapX && Math.abs(bx - ax) > width / 2) bx += bx < ax ? width : -width;
        const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
        const a = pos(ax, ay), b = pos(to % width, by);
        let dLon = b.lon - a.lon;
        if (dLon > Math.PI) dLon -= 2 * Math.PI;
        else if (dLon < -Math.PI) dLon += 2 * Math.PI;
        for (let k = displayPath.length ? 1 : 0; k < line.length; k++) {
          const cell = line[k];
          let cx = cell % width;
          if (grid.wrapX && Math.abs(cx - ax) > width / 2) cx += cx < ax ? width : -width;
          const cy = Math.floor(cell / width);
          const t = length2 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / length2)) : 0;
          const ll = pos(ax, ay);
          displayPath.push({
            x: cx, y: cy,
            lon: (ll.lon + dLon * t) / radians,
            lat: (a.lat + (b.lat - a.lat) * t) / radians,
            elevationM: heightAt(cell),
          });
        }
      }
      if (!ids.length) ids.push(startId);
      let horizontalDistanceM = 0;
      const path = ids.map((at, i) => {
        const x = at % width, y = Math.floor(at / width);
        if (i) { const prev = ids[i - 1]; horizontalDistanceM += horizontal(prev % width, Math.floor(prev / width), x, y); }
        const ll = pos(x, y);
        return { x, y, lon: ll.lon / radians, lat: ll.lat / radians, elevationM: heightAt(at) };
      });
      if (!displayPath.length) displayPath.push(path[0]);
      return { path, displayPath, turnIndices, horizontalDistanceM, terrainDistanceM: currentCost };
    }
    closed.add(id);
    const x = id % width, y = Math.floor(id / width);
    for (const [ox, oy] of moves) {
      let nx = x + ox;
      const ny = y + oy;
      if (grid.wrapX) nx = (nx + width) % width;
      else if (nx < 0 || nx >= width) continue;
      if (ny < 0 || ny >= height) continue;
      const next = ny * width + nx;
      if (closed.has(next)) continue;
      if (cellSlope(next) > maxSlopeDeg) continue;
      const parentId = parent.get(id);
      let via = id, step = segment(id, next);
      if (parentId !== undefined) {
        const shortcut = segment(parentId, next);
        if (shortcut && g.get(parentId) + shortcut.cost < currentCost + (step?.cost ?? Infinity)) {
          via = parentId; step = shortcut;
        }
      }
      if (!step) continue;
      const tentative = (via === id ? currentCost : g.get(via)) + step.cost;
      if (tentative >= (g.get(next) ?? Infinity)) continue;
      g.set(next, tentative); parent.set(next, via);
      push([tentative + heuristic({ x: nx, y: ny }), tentative, next]);
    }
  }
  return null;
}

// Remove grid zig-zags only when a terrain-sampled shortcut respects the slope limit
// and costs no more surface distance than the original path section.
export function smoothTerrainPath(grid, path, maxSlopeDeg) {
  if (path.length < 3) return path;
  const { width, heights, wrapX, westDeg, northDeg, lonStepDeg, latStepDeg } = grid;
  const sparse = heights instanceof Map;
  const heightAt = (x, y) => {
    if (wrapX) x = (x + width) % width;
    if (x < 0 || x >= width || y < 0 || y >= grid.height) return undefined;
    const id = y * width + x;
    return sparse ? heights.get(id) : heights[id];
  };
  const radians = Math.PI / 180;
  const horizontal = (a, b) => {
    const latA = (northDeg + a.y * latStepDeg) * radians;
    const latB = (northDeg + b.y * latStepDeg) * radians;
    let dLon = (b.x - a.x) * lonStepDeg * radians;
    if (dLon > Math.PI) dLon -= 2 * Math.PI;
    else if (dLon < -Math.PI) dLon += 2 * Math.PI;
    return Math.hypot(dLon * 3_396_190 * Math.cos((latA + latB) / 2),
      (latB - latA) * 3_396_190);
  };
  const rasterLine = (a, b) => {
    let x0 = a.x, y0 = a.y, x1 = b.x, y1 = b.y;
    if (wrapX && Math.abs(x1 - x0) > width / 2) x1 += x1 < x0 ? width : -width;
    const points = [], dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      points.push({ x: wrapX ? (x0 + width) % width : x0, y: y0 });
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return points;
  };
  const segmentCost = (a, b) => {
    const run = rasterLine(a, b);
    let cost = 0;
    for (let k = 1; k < run.length; k++) {
      const prev = run[k - 1], next = run[k];
      const h0 = heightAt(prev.x, prev.y), h1 = heightAt(next.x, next.y);
      if (h0 === undefined || h1 === undefined) return null;
      const d = horizontal(prev, next), rise = Math.abs(h1 - h0);
      if (rise > d * Math.tan(maxSlopeDeg * radians)) return null;
      cost += Math.hypot(d, rise);
    }
    return { cost, run };
  };
  const prefix = new Float64Array(path.length);
  for (let i = 1; i < path.length; i++) {
    const d = horizontal(path[i - 1], path[i]);
    prefix[i] = prefix[i - 1] + Math.hypot(d, path[i].elevationM - path[i - 1].elevationM);
  }

  const output = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let chosen = i + 1, chosenRun = null;
    const furthest = Math.min(path.length - 1, i + 16);
    for (let j = furthest; j > i + 1; j--) {
      const shortcut = segmentCost(path[i], path[j]);
      if (shortcut && shortcut.cost <= prefix[j] - prefix[i] + 1e-3) {
        chosen = j; chosenRun = shortcut.run; break;
      }
    }
    if (chosenRun) {
      for (let k = 1; k < chosenRun.length; k++) {
        const p = chosenRun[k], elevationM = heightAt(p.x, p.y);
        const lon = westDeg + p.x * lonStepDeg;
        const lat = northDeg + p.y * latStepDeg;
        output.push({ x: p.x, y: p.y, lon, lat, elevationM });
      }
    } else output.push(path[chosen]);
    i = chosen;
  }
  return output;
}
