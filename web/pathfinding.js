// Local, terrain-only A* over numeric MOLA height tiles served by serve.mjs.
// Trek's MOLA/HRSC relief layer is color imagery; these heights come from numeric MOLA.
const TILE_CELLS = 64;
const TILE_SAMPLES = TILE_CELLS + 1;
const MARS_RADIUS_M = 3_396_190;

async function fetchHeightTile(z, x, y, signal) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const response = await fetch(`/terrain/${z}/${x}/${y}`, { signal, cache: "force-cache" });
    if (response.status === 202) {
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
    return new Float32Array(bytes);
  }
  throw new Error(`MOLA height tile ${z}/${x}/${y} is still being prepared`);
}

// Bounds are Mars longitude/latitude degrees. Keep the patch local; the source data is
// fetched only for intersecting Cesium tiles and no whole-planet raster is built.
export async function loadTerrainPatch({ west, south, east, north, level = 6, signal, maxCells = 4_000_000 }) {
  if (![west, south, east, north].every(Number.isFinite) || south >= north ||
      west < -180 || east > 180 || south < -90 || north > 90)
    throw new RangeError("Expected Mars bounds; west > east is allowed across the longitude seam");
  if (!Number.isInteger(level) || level < 0 || level > 22) throw new RangeError("Invalid terrain level");

  const tilesX = 2 ** (level + 1), tilesY = 2 ** level;
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

  const tiles = await Promise.all(Array.from({ length: nx * ny }, async (_, i) => {
    const tx = xs[i % nx], ty = y0 + Math.floor(i / nx);
    return fetchHeightTile(level, tx, ty, signal);
  }));
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

export function lonLatToTerrainCell(grid, lonDeg, latDeg) {
  let lon = lonDeg;
  while (lon < grid.westDeg) lon += 360;
  while (lon >= grid.westDeg + grid.width * grid.lonStepDeg) lon -= 360;
  const x = Math.round((lon - grid.westDeg) / grid.lonStepDeg);
  const y = Math.round((latDeg - grid.northDeg) / grid.latStepDeg);
  if (x < 0 || x >= grid.width || y < 0 || y >= grid.height) return null;
  return { x, y };
}

export function planTerrainRoute(grid, start, goal) {
  const { width, height, heights, westDeg, northDeg, lonStepDeg, latStepDeg } = grid;
  if (!(heights instanceof Float32Array) || heights.length !== width * height)
    throw new TypeError("heights must be a Float32Array matching grid dimensions");
  const inBounds = (p) => Number.isInteger(p.x) && Number.isInteger(p.y) &&
    p.x >= 0 && p.x < width && p.y >= 0 && p.y < height;
  if (!inBounds(start) || !inBounds(goal)) throw new RangeError("start/goal outside terrain patch");

  const index = (p) => p.y * width + p.x;
  const startId = index(start), goalId = index(goal);
  const radians = Math.PI / 180;
  const pos = (x, y) => ({
    lat: (northDeg + y * latStepDeg) * radians,
    lon: (westDeg + x * lonStepDeg) * radians,
  });
  const horizontal = (x0, y0, x1, y1) => {
    const a = pos(x0, y0), b = pos(x1, y1), midLat = (a.lat + b.lat) / 2;
    const east = (b.lon - a.lon) * MARS_RADIUS_M * Math.cos(midLat);
    const north = (b.lat - a.lat) * MARS_RADIUS_M;
    return Math.hypot(east, north);
  };
  const heuristic = (p) => horizontal(p.x, p.y, goal.x, goal.y);
  const g = new Map([[startId, 0]]), parent = new Map(), closed = new Set();

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

  push([heuristic(start), 0, startId]);
  const moves = [[-1,-1], [0,-1], [1,-1], [-1,0], [1,0], [-1,1], [0,1], [1,1]];
  while (heap.length) {
    const [, currentCost, id] = pop();
    if (closed.has(id) || currentCost !== g.get(id)) continue;
    if (id === goalId) {
      const ids = [];
      for (let at = id; at !== undefined; at = parent.get(at)) ids.push(at);
      ids.reverse();
      let horizontalDistanceM = 0;
      const path = ids.map((at, i) => {
        const x = at % width, y = Math.floor(at / width);
        if (i) {
          const prev = ids[i - 1], px = prev % width, py = Math.floor(prev / width);
          horizontalDistanceM += horizontal(px, py, x, y);
        }
        const ll = pos(x, y);
        return { x, y, lon: ll.lon / radians, lat: ll.lat / radians, elevationM: heights[at] };
      });
      return { path, horizontalDistanceM, terrainDistanceM: currentCost };
    }
    closed.add(id);
    const x = id % width, y = Math.floor(id / width), here = heights[id];
    for (const [ox, oy] of moves) {
      const nx = x + ox, ny = y + oy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const next = ny * width + nx;
      if (closed.has(next)) continue;
      const surfaceStep = Math.hypot(horizontal(x, y, nx, ny), heights[next] - here);
      const tentative = currentCost + surfaceStep;
      if (tentative >= (g.get(next) ?? Infinity)) continue;
      g.set(next, tentative); parent.set(next, id);
      push([tentative + heuristic({ x: nx, y: ny }), tentative, next]);
    }
  }
  return null;
}
