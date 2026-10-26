import { type MaskVertex } from "./model";
const mix = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
const add = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
  x: a.x + b.x,
  y: a.y + b.y,
});
const sub = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
  x: a.x - b.x,
  y: a.y - b.y,
});
/** De Casteljau subdivision preserves the exact original cubic curve. */
export function insertVertex(
  vertices: MaskVertex[],
  index: number,
): MaskVertex[] {
  const copy = vertices.map((v) => ({
    ...v,
    in: { ...v.in },
    out: { ...v.out },
  }));
  const a = copy[index],
    b = copy[(index + 1) % copy.length];
  const p1 = add(a, a.out),
    p2 = add(b, b.in),
    q0 = mix(a, p1),
    q1 = mix(p1, p2),
    q2 = mix(p2, b),
    r0 = mix(q0, q1),
    r1 = mix(q1, q2),
    s = mix(r0, r1);
  a.out = sub(q0, a);
  b.in = sub(q2, b);
  copy.splice(index + 1, 0, {
    id: crypto.randomUUID(),
    ...s,
    in: sub(r0, s),
    out: sub(r1, s),
  });
  return copy;
}
export function smoothVertex(
  vertices: MaskVertex[],
  index: number,
): MaskVertex[] {
  const copy = vertices.map((v) => ({
    ...v,
    in: { ...v.in },
    out: { ...v.out },
  }));
  const a = copy[(index + copy.length - 1) % copy.length],
    b = copy[(index + 1) % copy.length];
  const tangent = { x: (b.x - a.x) / 6, y: (b.y - a.y) / 6 };
  copy[index].out = tangent;
  copy[index].in = { x: -tangent.x, y: -tangent.y };
  return copy;
}
