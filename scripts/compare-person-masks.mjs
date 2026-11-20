// Compare two person-mask runs of the same clip, sample by sample: how far the outlines differ
// (mean point distance, frame fractions; outlines aligned by their starting phase) and how many
// samples are identical. Usage: node scripts/compare-person-masks.mjs BEFORE.json AFTER.json
import fs from "node:fs";
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
const byTime = new Map(b.map((s) => [s.timeMs, s]));
let same = 0,
  compared = 0,
  worst = 0;
const dists = [];
for (const s of a) {
  const t = byTime.get(s.timeMs);
  if (!t) continue;
  compared++;
  if (JSON.stringify(s.points) === JSON.stringify(t.points)) {
    same++;
    dists.push(0);
    continue;
  }
  if (!s.points.length || !t.points.length) {
    dists.push(s.points.length === t.points.length ? 0 : 1);
    continue;
  }
  // Best cyclic alignment of the two 96-point outlines.
  let best = Infinity;
  for (let shift = 0; shift < t.points.length; shift += 2) {
    let d = 0;
    for (let i = 0; i < s.points.length; i++) {
      const p = s.points[i],
        q = t.points[(i + shift) % t.points.length];
      d += Math.hypot(p[0] - q[0], p[1] - q[1]);
    }
    best = Math.min(best, d / s.points.length);
  }
  dists.push(best);
  worst = Math.max(worst, best);
}
dists.sort((x, y) => x - y);
console.log(
  JSON.stringify({
    compared,
    identical: same,
    meanDistance: Number((dists.reduce((x, y) => x + y, 0) / Math.max(1, dists.length)).toFixed(4)),
    p95Distance: Number((dists[Math.floor(dists.length * 0.95)] ?? 0).toFixed(4)),
    worstDistance: Number(worst.toFixed(4)),
  }),
);
