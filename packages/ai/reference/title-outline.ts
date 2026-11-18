/** Vector outlines of measured lettering. Used when no installed face resembles a reference's
 * hand-drawn or decorative word: the lettering itself becomes an editable shape, its outer
 * contours added and its counters subtracted, instead of an approximate font. */
export interface Outline {
  /** Counter (hole) rather than outer contour. */
  hole: boolean;
  points: [number, number][];
}
type Box = { x: number; y: number; width: number; height: number };

/** Closed pixel-edge boundaries of the ink inside `box`, with ink always on the right of travel:
 * outer contours run clockwise on screen (positive area), counters anticlockwise. */
export function traceBoundaries(mask: Uint8Array, width: number, box: Box) {
  const ink = (x: number, y: number) =>
    x >= box.x && y >= box.y && x < box.x + box.width && y < box.y + box.height && !!mask[y * width + x];
  const key = (x: number, y: number) => y * (width + 2) + x;
  const out = new Map<number, [number, number][]>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = key(x0, y0);
    const list = out.get(k) ?? [];
    list.push([x1, y1]);
    out.set(k, list);
  };
  for (let y = box.y; y < box.y + box.height; y++)
    for (let x = box.x; x < box.x + box.width; x++) {
      if (!ink(x, y)) continue;
      if (!ink(x, y - 1)) add(x, y, x + 1, y);
      if (!ink(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!ink(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!ink(x - 1, y)) add(x, y + 1, x, y);
    }
  const loops: [number, number][][] = [];
  for (const [start, list] of out)
    while (list.length) {
      const sx = start % (width + 2),
        sy = Math.floor(start / (width + 2));
      const loop: [number, number][] = [[sx, sy]];
      let [px, py] = [sx, sy],
        [nx, ny] = list.pop()!;
      for (let guard = 0; guard < 1e6 && !(nx === sx && ny === sy); guard++) {
        loop.push([nx, ny]);
        const options = out.get(key(nx, ny));
        if (!options?.length) break;
        // Where two contours touch at a corner, keep turning right so each stays separate.
        const dx = nx - px,
          dy = ny - py;
        let pick = 0;
        if (options.length > 1) {
          const right = options.findIndex(([ox, oy]) => ox - nx === -dy && oy - ny === dx);
          if (right >= 0) pick = right;
        }
        [px, py] = [nx, ny];
        [nx, ny] = options.splice(pick, 1)[0];
      }
      if (loop.length >= 4) loops.push(loop);
    }
  return loops;
}

const area = (p: [number, number][]) => {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i],
      [x1, y1] = p[(i + 1) % p.length];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
};

/** Douglas–Peucker on a closed polygon. */
export function simplify(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length <= 4) return points;
  const reduce = (p: [number, number][]): [number, number][] => {
    if (p.length < 3) return p;
    const [ax, ay] = p[0],
      [bx, by] = p[p.length - 1],
      len = Math.hypot(bx - ax, by - ay) || 1;
    let far = 0,
      index = 0;
    for (let i = 1; i < p.length - 1; i++) {
      const d = Math.abs((bx - ax) * (ay - p[i][1]) - (ax - p[i][0]) * (by - ay)) / len;
      if (d > far) {
        far = d;
        index = i;
      }
    }
    if (far <= epsilon) return [p[0], p[p.length - 1]];
    return [...reduce(p.slice(0, index + 1)).slice(0, -1), ...reduce(p.slice(index))];
  };
  // Split at the point farthest from the first so both halves are open chains.
  let far = 0,
    split = 0;
  points.forEach(([x, y], i) => {
    const d = Math.hypot(x - points[0][0], y - points[0][1]);
    if (d > far) {
      far = d;
      split = i;
    }
  });
  const a = reduce(points.slice(0, split + 1)),
    b = reduce([...points.slice(split), points[0]]);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Outlines of the lettering, at most `limit` contours of at most `maxPoints` points, largest
 * first. Specks are dropped. Coordinates are mask pixels. */
export function letteringOutlines(mask: Uint8Array, width: number, box: Box, limit = 32, maxPoints = 128): Outline[] {
  const loops = traceBoundaries(mask, width, box)
    .map((points) => ({ points, area: area(points) }))
    .filter((l) => Math.abs(l.area) >= 8)
    .sort((a, b) => Math.abs(b.area) - Math.abs(a.area))
    .slice(0, limit);
  return loops.map(({ points, area: a }) => {
    let epsilon = 1.1,
      simple = simplify(points, epsilon);
    while (simple.length > maxPoints) simple = simplify(points, (epsilon *= 1.4));
    return { hole: a < 0, points: simple };
  });
}

/** Smooth tangents for a closed outline: Catmull–Rom where the contour bends gently, none at a
 * sharp corner so serifs and stroke ends stay crisp. Units match the points. */
export function outlineTangents(points: [number, number][]) {
  const n = points.length;
  return points.map((p, i) => {
    const a = points[(i - 1 + n) % n],
      b = points[(i + 1) % n];
    const ux = p[0] - a[0],
      uy = p[1] - a[1],
      vx = b[0] - p[0],
      vy = b[1] - p[1];
    const cos = (ux * vx + uy * vy) / ((Math.hypot(ux, uy) || 1) * (Math.hypot(vx, vy) || 1));
    if (cos < 0.3) return [0, 0] as [number, number];
    return [(b[0] - a[0]) / 6, (b[1] - a[1]) / 6] as [number, number];
  });
}

/** The lettering field smoothed with a 3×3 Gaussian and resampled `scale` times finer, then
 * thresholded: staircase edges become curves and hairline gaps from codec damage close. Returns
 * outlines in the original mask's pixel units. */
export function smoothOutlines(mask: Uint8Array, width: number, box: Box, scale = 2, level = 0.4) {
  const pad = 2,
    w = box.width + 2 * pad,
    h = box.height + 2 * pad,
    field = new Float32Array(w * h);
  const at = (x: number, y: number) => {
    const mx = box.x - pad + x,
      my = box.y - pad + y;
    return mx >= box.x && my >= box.y && mx < box.x + box.width && my < box.y + box.height ? mask[my * width + mx] : 0;
  };
  const k = [1, 2, 1];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += k[dx + 1] * k[dy + 1] * at(x + dx, y + dy);
      field[y * w + x] = s / 16;
    }
  const W = w * scale,
    H = h * scale,
    fine = new Uint8Array(W * H);
  for (let Y = 0; Y < H; Y++)
    for (let X = 0; X < W; X++) {
      const fx = Math.min(w - 1, Math.max(0, (X + 0.5) / scale - 0.5)),
        fy = Math.min(h - 1, Math.max(0, (Y + 0.5) / scale - 0.5)),
        x0 = Math.floor(fx),
        y0 = Math.floor(fy),
        x1 = Math.min(w - 1, x0 + 1),
        y1 = Math.min(h - 1, y0 + 1),
        tx = fx - x0,
        ty = fy - y0;
      const v =
        (field[y0 * w + x0] * (1 - tx) + field[y0 * w + x1] * tx) * (1 - ty) +
        (field[y1 * w + x0] * (1 - tx) + field[y1 * w + x1] * tx) * ty;
      if (v >= level) fine[Y * W + X] = 1;
    }
  return letteringOutlines(fine, W, { x: 0, y: 0, width: W, height: H }).map((o) => ({
    hole: o.hole,
    points: o.points.map(([x, y]) => [box.x - pad + x / scale, box.y - pad + y / scale] as [number, number]),
  }));
}
