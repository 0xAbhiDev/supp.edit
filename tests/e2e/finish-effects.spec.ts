import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
test("finishing effects match GPU/CPU, preserve transparency and survive manual grain edits", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const sm = "/packages/project-schema/index.ts",
      cm = "/packages/engine/compositor.ts",
      em = "/packages/editor-state/index.ts";
    const { newProject, newClip } = await import(sm),
      { Compositor } = await import(cm),
      { useEditor } = await import(em);
    const p = newProject("Aesthetic finish test", 320, 180),
      c = newClip(p.tracks[0].id, 0, 60, "shape");
    c.name = "Finish card";
    c.shape = { type: "rectangle", width: 280, height: 140, color: "#b4765a" };
    p.clips = [c];
    const a = document.createElement("canvas"),
      b = document.createElement("canvas"),
      gpu = new Compositor(a, true),
      cpu = new Compositor(b, true, { renderer: "cpu" }),
      report: any[] = [];
    const cases = [
      { type: "tonalContrast", value: 1.09 },
      { type: "temperature", value: 0.2 },
      { type: "vignette", value: 0.12 },
      { type: "sharpen", value: 0.15 },
      { type: "grain", value: 0.025, parameters: { size: 1.2, softness: 0.6 } },
      { type: "grain", value: 0.1, parameters: { size: 4, softness: 1 } },
    ];
    for (const [i, e] of cases.entries()) {
      c.effectStack = [{ id: "finish", enabled: true, keys: [], ...e }];
      for (const frame of [0, 11]) {
        const ga = await gpu.render(p, frame, false, 1, true, "transparent"),
          ca = await cpu.render(p, frame, false, 1, true, "transparent");
        if (ga || ca) throw ga || ca;
        const x = a.getContext("2d")!.getImageData(0, 0, 320, 180).data,
          y = b.getContext("2d")!.getImageData(0, 0, 320, 180).data;
        report.push({
          case: i,
          type: e.type,
          frame,
          backend: gpu.backend,
          fallback: gpu.fallback,
          alpha: x[3],
          mae:
            x.reduce(
              (n: number, v: number, j: number) => n + Math.abs(v - y[j]),
              0,
            ) / x.length,
        });
      }
    }
    c.effectStack = cases
      .slice(0, 5)
      .map((e, i) => ({ id: `fx-${i}`, enabled: true, keys: [], ...e }));
    await gpu.render(p, 11, false, 1, true);
    const image = a.toDataURL("image/png").split(",")[1];
    await gpu.dispose();
    await cpu.dispose();
    useEditor.getState().load(p);
    useEditor.getState().select(c.id);
    return { report, image };
  });
  for (const row of result.report) {
    expect(row.backend, row.fallback).toContain("WebGL2");
    expect(row.mae, JSON.stringify(row)).toBeLessThan(0.65);
    expect(row.alpha).toBe(0);
  }
  await page.getByLabel("Grain size 5", { exact: true }).fill("2.4");
  await page.getByLabel("Grain softness 5", { exact: true }).fill("0.75");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  const saved = await fs.readFile((await download.path())!, "utf8");
  expect(JSON.parse(saved).clips[0].effectStack[4].parameters).toEqual({
    size: 2.4,
    softness: 0.75,
  });
  await fs.mkdir("test-results/aesthetic-finish", { recursive: true });
  await fs.writeFile(
    "test-results/aesthetic-finish/gpu-cpu.json",
    JSON.stringify(result.report, null, 2),
  );
  await fs.writeFile(
    "test-results/aesthetic-finish/preview.png",
    Buffer.from(result.image, "base64"),
  );
  await fs.writeFile("test-results/aesthetic-finish/manual.supp", saved);
});
