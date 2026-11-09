import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import capture from "../fixtures/gym-analysis.json" with { type: "json" };
test("every text treatment renders animated CPU/GPU pixels with editable decorations", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/");
  const report = await page.evaluate(async () => {
    const sm = "/packages/project-schema/index.ts",
      cm = "/packages/engine/compositor.ts",
      tm = "/packages/typography/treatments.ts",
      mm = "/packages/typography/model.ts";
    const { newProject, newClip } = await import(sm),
      { Compositor } = await import(cm),
      { styleText, animateText } = await import(tm),
      { textTreatments } = await import(mm);
    const p = newProject("Text render parity", 360, 640),
      a = document.createElement("canvas"),
      b = document.createElement("canvas"),
      gpu = new Compositor(a, true),
      cpu = new Compositor(b, true, { renderer: "cpu" }),
      out = [];
    for (const treatment of textTreatments) {
      const c = newClip(p.tracks[0].id, 0, 60, "text");
      c.text.content = "ONE MORE REP";
      styleText(c, "Aggressive", 360, 640, treatment);
      c.text.size = 38;
      c.text.maxWidth = 270;
      c.text.strokeWidth = 1;
      c.text.shadowBlur = 3;
      c.text.backgroundOpacity = 0.25;
      c.text.backgroundRadius = 14;
      c.transform.y = 0;
      animateText(c, treatment, 30, [0, 16, 32]);
      p.clips = [c];
      const sums = [];
      for (const frame of [0, 3, 12, 24, 40, 59]) {
        const x = await gpu.render(p, frame, false, 1, true, "transparent"),
          y = await cpu.render(p, frame, false, 1, true, "transparent");
        if (x || y) throw x || y;
        const ga = a.getContext("2d")!.getImageData(0, 0, 360, 640).data,
          ca = b.getContext("2d")!.getImageData(0, 0, 360, 640).data;
        let error = 0,
          sum = 0;
        for (let i = 0; i < ga.length; i++) {
          error += Math.abs(ga[i] - ca[i]);
          if (i % 4 === 3) sum += ga[i];
        }
        sums.push(sum);
        out.push({
          treatment,
          frame,
          mae: error / ga.length,
          sum,
          backend: gpu.backend,
          fallback: gpu.fallback,
          ...(treatment === "Punch" && frame === 3
            ? { gpu: a.toDataURL(), cpu: b.toDataURL() }
            : {}),
        });
      }
      if (new Set(sums).size < 3) throw Error(treatment + " does not animate");
    }
    await gpu.dispose();
    await cpu.dispose();
    return out;
  });
  await fs.mkdir("test-results/typography", { recursive: true });
  for (const r of report) {
    if (r.gpu && r.cpu) {
      await fs.writeFile(
        "test-results/typography/punch-gpu.png",
        Buffer.from(r.gpu.split(",")[1], "base64"),
      );
      await fs.writeFile(
        "test-results/typography/punch-cpu.png",
        Buffer.from(r.cpu.split(",")[1], "base64"),
      );
    }
  }
  await fs.writeFile(
    "test-results/typography/parity-debug.json",
    JSON.stringify(
      report.map(({ gpu, cpu, ...r }) => r),
      null,
      2,
    ),
  );
  for (const r of report) {
    expect(r.backend, r.fallback).toContain("WebGL2");
    expect(
      r.mae,
      JSON.stringify({ t: r.treatment, f: r.frame, mae: r.mae }),
    ).toBeLessThan(1.5);
    if (r.frame === 0 || r.frame === 59) expect(r.sum).toBe(0);
  }
  await fs.mkdir("test-results/typography", { recursive: true });
  await fs.writeFile(
    "test-results/typography/render-parity.json",
    JSON.stringify(report, null, 2),
  );
});
test("gym prompt creates sparse measured music typography, supports manual edits, Undo/Redo and reopen", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  const dir = path.resolve("test-results/typography");
  await fs.mkdir(dir, { recursive: true });
  const assets = capture.assets.filter(
    (a) =>
      [
        "gym-fixture-bench",
        "gym-fixture-deadlift",
        "gym-fixture-incline",
      ].includes(a.id) || a.kind === "audio",
  );
  await page.goto("/");
  for (const asset of assets)
    await page.evaluate(
      async ({ asset, bytes }) => {
        const m = "/packages/platform/storage.ts";
        await (
          await import(m)
        ).writeLocal(
          "media",
          `${asset.id}:${asset.fingerprint}`,
          new Blob([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], {
            type: asset.kind === "audio" ? "audio/wav" : "video/webm",
          }),
        );
      },
      { asset, bytes: (await fs.readFile(asset.path)).toString("base64") },
    );
  await page.evaluate(
    async ({ assets, analyses }) => {
      const sm = "/packages/project-schema/index.ts",
        em = "/packages/editor-state/index.ts",
        dm = "/packages/platform/derived.ts";
      const { newProject, newClip } = await import(sm),
        { useEditor } = await import(em),
        { writeDerived } = await import(dm);
      const p = newProject("Kinetic gym typography acceptance", 360, 640);
      p.assets = assets;
      let at = 0;
      for (const a of assets) {
        const c = newClip(
          p.tracks[a.kind === "audio" ? 1 : 0].id,
          a.kind === "audio" ? 0 : at,
          a.kind === "audio" ? 360 : 120,
        );
        c.assetId = a.id;
        c.name = a.name;
        c.gain = a.kind === "audio" ? -8 : -60;
        p.clips.push(c);
        if (a.kind !== "audio") at += 120;
      }
      for (const a of analyses)
        await writeDerived(
          `analysis-v1:${a.assetId}:${a.fingerprint}:${a.settings.task}`,
          a,
          JSON.stringify(a).length * 2,
        );
      useEditor.getState().load(p);
    },
    {
      assets,
      analyses: capture.analyses.filter((a) =>
        assets.some((s) => s.id === a.assetId),
      ),
    },
  );
  const state = async (p = page) =>
    p.evaluate(async () => {
      const m = "/packages/editor-state/index.ts";
      return (await import(m)).useEditor.getState().project;
    });
  const before = await state();
  await page.getByRole("button", { name: "AI Studio", exact: true }).click();
  await page
    .getByLabel("Describe your edit")
    .fill(
      "Add aggressive motivational kinetic typography to this gym Reel. Use only a few strong words, make the most important words large, synchronize key text hits with strong music events, keep the athlete visible, and keep the design clean rather than covering the entire screen.",
    );
  await page
    .getByRole("button", { name: "Preview edit plan", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Create edit", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  expect(await state()).toEqual(before);
  await expect(
    page.getByText(/measured strong music events timing; suggested copy/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Preview revision", exact: true })
    .click();
  await expect
    .poll(() => page.getByLabel("Revision preview frame").inputValue())
    .not.toBe("0");
  await page
    .getByRole("button", { name: "Pause revision preview", exact: true })
    .click();
  await page.getByRole("button", { name: "Create edit", exact: true }).click();
  const applied = await state();
  expect(applied.clips.filter((c: any) => c.kind === "text").length).toBe(4);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await state()).toEqual(before);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect(await state()).toEqual(applied);
  const title = applied.clips.find((c: any) => c.kind === "text");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("button", { name: `Clip ${title.name}`, exact: true })
    .click();
  await page.getByLabel("Font size", { exact: true }).fill("23.5");
  await page.getByLabel("Text stroke width", { exact: true }).fill("1.25");
  await page.getByLabel("Text background opacity", { exact: true }).fill("0.2");
  const edited = await state();
  expect(edited.clips.find((c: any) => c.id === title.id).text.size).toBe(23.5);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  const saved = await fs.readFile((await download.path())!, "utf8");
  await fs.writeFile(path.join(dir, "EDITABLE.supp"), saved);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/");
  await reopened.getByTestId("project-input").setInputFiles({
    name: "Typography.supp",
    mimeType: "application/json",
    buffer: Buffer.from(saved),
  });
  expect((await state(reopened)).clips).toEqual(edited.clips);
  // References include each entrance and settled frame, rendered by the real compositor.
  await reopened.exposeFunction(
    "saveTextReference",
    async (frame: number, png: string) =>
      fs.writeFile(
        path.join(dir, `reference-${frame}.png`),
        Buffer.from(png.split(",")[1], "base64"),
      ),
  );
  const references = await reopened.evaluate(async () => {
    const em = "/packages/editor-state/index.ts",
      cm = "/packages/engine/compositor.ts";
    const p = (await import(em)).useEditor.getState().project,
      { Compositor } = await import(cm),
      canvas = document.createElement("canvas"),
      r = new Compositor(canvas, true, { renderer: "cpu" }),
      frames = p.clips
        .filter((c: any) => c.kind === "text")
        .flatMap((c: any) => [c.start + 2, c.start + 8, c.start + 20]);
    for (const f of frames) {
      const e = await r.render(p, f, false, 1, true);
      if (e) throw e;
      await (window as any).saveTextReference(f, canvas.toDataURL("image/png"));
    }
    await r.dispose();
    return frames;
  });
  await fs.writeFile(
    path.join(dir, "references.json"),
    JSON.stringify(references),
  );
  await reopened.screenshot({ path: path.join(dir, "reopened.png") });
});
