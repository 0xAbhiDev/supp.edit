import type { TextAppearance } from "./appearance";
import type { PersonSample } from "./subject-mask";

function inside(x: number, y: number, points: PersonSample["points"]) {
  let on = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[i],
      [bx, by] = points[j];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax)
      on = !on;
  }
  return on;
}
// A crossing of bounding boxes is not evidence for occlusion. Compare observed ink
// to the local font outline on both sides of the *same timestamp's* person contour.
export function measureTextDepth(
  line: TextAppearance,
  people: PersonSample[],
): TextAppearance {
  const template = line.templateRows;
  if (!template || !line.face || !line.geometry?.length) return line;
  const observations: {
    timeMs: number;
    insideRetention: number;
    outsideRetention: number;
  }[] = [];
  for (const box of line.geometry) {
    if (!box.rows) continue;
    const subject = people.reduce<PersonSample | undefined>(
      (a, b) =>
        !a || Math.abs(b.timeMs - box.timeMs) < Math.abs(a.timeMs - box.timeMs)
          ? b
          : a,
      undefined,
    );
    if (!subject?.points.length || Math.abs(subject.timeMs - box.timeMs) > 75)
      continue;
    const total = [0, 0],
      hits = [0, 0];
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 32; x++) {
        if (((template[y] >>> x) & 1) === 0) continue;
        const k = Number(
          inside(
            box.x + ((x + 0.5) * box.width) / 32,
            box.y + ((y + 0.5) * box.height) / 16,
            subject.points,
          ),
        );
        total[k]++;
        hits[k] += (box.rows[y] >>> x) & 1;
      }
    if (Math.min(...total) < 20) continue;
    observations.push({
      timeMs: box.timeMs,
      insideRetention: hits[1] / total[1],
      outsideRetention: hits[0] / total[0],
    });
  }
  const behind = observations.filter(
    (s) =>
      s.outsideRetention > 0.6 &&
      s.insideRetention < 0.42 &&
      s.outsideRetention - s.insideRetention > 0.32,
  );
  const front = observations.filter(
    (s) =>
      s.outsideRetention > 0.63 &&
      s.insideRetention > 0.68 &&
      Math.abs(s.outsideRetention - s.insideRetention) < 0.22,
  );
  const consistent = (n: number) => n >= 2 && n / observations.length >= 0.75;
  return {
    ...line,
    depth: {
      relation: consistent(behind.length)
        ? "behind"
        : consistent(front.length)
          ? "front"
          : "unknown",
      observations,
    },
  };
}
