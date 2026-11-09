import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
test("real saved speech supplies karaoke word keys and renders after reopen", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const dir = path.resolve("test-results/typography-speech");
  await fs.mkdir(dir, { recursive: true });
  const p = JSON.parse(
    await fs.readFile("test-results/audio-mix/NATIVE_AUDIO.supp", "utf8"),
  );
  await page.goto("/");
  for (const asset of p.assets)
    await page.evaluate(
      async ({ asset, bytes }) => {
        const m = "/packages/platform/storage.ts";
        await (
          await import(m)
        ).writeLocal(
          "media",
          `${asset.id}:${asset.fingerprint}`,
          new Blob([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], {
            type: asset.kind === "audio" ? "audio/wav" : "video/mp4",
          }),
        );
      },
      { asset, bytes: (await fs.readFile(asset.path)).toString("base64") },
    );
  await page
    .getByTestId("project-input")
    .setInputFiles({
      name: "speech.supp",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(p)),
    });
  await page.getByLabel("Active sequence").selectOption(p.compositions[0].id);
  await page.getByRole("button", { name: "AI Studio", exact: true }).click();
  await page
    .getByLabel("Describe your edit")
    .fill("Add Karaoke Highlight typography from spoken transcript");
  await page
    .getByRole("button", { name: "Preview edit plan", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Create edit", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Create edit", exact: true }).click();
  const result = await page.evaluate(async () => {
    const m = "/packages/editor-state/index.ts";
    return (await import(m)).useEditor.getState().project;
  });
  const layers = result.compositions[0].layers.filter(
    (c: any) => c.keyframes.highlight.length,
  );
  expect(layers.length).toBeGreaterThan(0);
  expect(layers.some((c: any) => c.keyframes.highlight.length > 1)).toBe(true);
  const expected = p.compositions[0].layers
    .filter((c: any) => c.kind === "media")
    .flatMap((c: any) =>
      p.transcripts
        .filter((t: any) => t.assetId === c.assetId)
        .flatMap((t: any) =>
          t.segments
            .flatMap((s: any) => s.words ?? [])
            .filter(
              (w: any) =>
                w.endMs > (c.sourceIn / 30) * 1000 &&
                w.startMs < ((c.sourceIn + c.duration) / 30) * 1000,
            )
            .map((w: any) => ({
              word: w.text,
              frame:
                c.start +
                Math.max(0, Math.round(w.startMs * 0.03) - c.sourceIn),
            })),
        ),
    );
  for (const layer of layers)
    for (const k of layer.keyframes.highlight)
      expect(
        expected.some(
          (e: any) =>
            e.word === layer.text.content.split(/\s+/)[k.value] &&
            e.frame === layer.start + k.frame,
        ),
      ).toBe(true);
  const saved = JSON.stringify(result);
  await fs.writeFile(path.join(dir, "EDITABLE.supp"), saved);
  await page.close();
  const q = await context.newPage();
  await q.goto("/");
  await q
    .getByTestId("project-input")
    .setInputFiles({
      name: "speech-type.supp",
      mimeType: "application/json",
      buffer: Buffer.from(saved),
    });
  await q.getByLabel("Active sequence").selectOption(p.compositions[0].id);
  await q.exposeFunction(
    "saveTypographyFrame",
    async (f: number, png: string) =>
      fs.writeFile(
        path.join(dir, `${f}.png`),
        Buffer.from(png.split(",")[1], "base64"),
      ),
  );
  const snapshot = await q.evaluate(async () => {
    const em = "/packages/editor-state/index.ts",
      sm = "/packages/commands/sequences.ts",
      cm = "/packages/engine/compositor.ts",
      pm = "/packages/project-schema/index.ts";
    const s = (await import(em)).useEditor.getState(),
      p = (await import(sm)).sequenceExportSnapshot(
        s.project,
        s.activeComposition,
      ),
      { Compositor } = await import(cm),
      { duration } = await import(pm),
      canvas = document.createElement("canvas"),
      r = new Compositor(canvas, true, { renderer: "cpu" });
    for (let f = 0; f < duration(p); f++) {
      const e = await r.render(p, f, false, 1, true);
      if (e) throw e;
      await (window as any).saveTypographyFrame(
        f,
        canvas.toDataURL("image/png"),
      );
    }
    await r.dispose();
    return p;
  });
  await fs.writeFile(path.join(dir, "project.supp"), JSON.stringify(snapshot));
});
test("all twenty authored animation treatments render a native-ready editable showcase", async ({
  page,
}) => {
  test.setTimeout(180000);
  const dir = path.resolve("test-results/typography-treatments");
  await fs.mkdir(dir, { recursive: true });
  await page.goto("/");
  await page.exposeFunction(
    "saveTypographyFrame",
    async (f: number, png: string) =>
      fs.writeFile(
        path.join(dir, `${f}.png`),
        Buffer.from(png.split(",")[1], "base64"),
      ),
  );
  const p = await page.evaluate(async () => {
    const sm = "/packages/project-schema/index.ts",
      cm = "/packages/engine/compositor.ts",
      mm = "/packages/typography/model.ts",
      tm = "/packages/typography/treatments.ts";
    const { newProject, newClip } = await import(sm),
      { Compositor } = await import(cm),
      { textTreatments } = await import(mm),
      { animateText, styleText } = await import(tm);
    const p = newProject("Editable text treatment showcase", 360, 640),
      bg = newClip(p.tracks[0].id, 0, textTreatments.length * 30, "shape");
    bg.shape = { type: "rectangle", width: 360, height: 640, color: "#17212A" };
    p.clips = [bg];
    // Authored demonstration timing; these are not asserted to be speech timestamps.
    const tr = {
      ...p.tracks[0],
      id: "text-showcase",
      name: "Editable treatments",
    };
    p.tracks.unshift(tr);
    for (const [t, treatment] of textTreatments.entries()) {
      const c = newClip(tr.id, t * 30, 30, "text");
      c.name = treatment;
      c.text.content = "ONE MORE REP";
      styleText(c, "Aggressive", 360, 640, treatment);
      c.text.size = 34;
      c.text.maxWidth = 270;
      c.transform.y = 0;
      animateText(c, treatment, 30, [0, 8, 16]);
      p.clips.push(c);
    }
    const canvas = document.createElement("canvas"),
      r = new Compositor(canvas, true, { renderer: "cpu" });
    for (let f = 0; f < textTreatments.length * 30; f++) {
      const e = await r.render(p, f, false, 1, true);
      if (e) throw e;
      await (window as any).saveTypographyFrame(
        f,
        canvas.toDataURL("image/png"),
      );
    }
    await r.dispose();
    return p;
  });
  await fs.writeFile(path.join(dir, "project.supp"), JSON.stringify(p));
  expect(p.clips.filter((c: any) => c.kind === "text")).toHaveLength(20);
});
