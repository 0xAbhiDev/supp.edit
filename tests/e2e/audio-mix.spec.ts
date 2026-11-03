import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import capture from "../fixtures/gym-analysis.json" with { type: "json" };
test("real recorded speech drives editable ducking, revision playback, manual gain, reopen and export frames", async ({
  page,
  context,
}) => {
  test.setTimeout(240000);
  const dir = path.resolve("test-results/audio-mix");
  await fs.mkdir(dir, { recursive: true });
  const analyses = await Promise.all(
    ["speech", "audio", "vision"].map(async (task) =>
      JSON.parse(
        await fs.readFile(
          `test-results/aesthetic-finish/speech-video-${task}.json`,
          "utf8",
        ),
      ),
    ),
  );
  const voiceFile = path.resolve(
      "test-results/aesthetic-finish/speech-video.mp4",
    ),
    voice = {
      id: analyses[0].assetId,
      fingerprint: analyses[0].fingerprint,
      name: "Bench with recorded speech",
      kind: "video",
      path: voiceFile,
      size: (await fs.stat(voiceFile)).size,
      duration: 14,
      width: 320,
      height: 180,
      fps: 30,
      codec: "h264",
      hasAudio: true,
    };
  const music = capture.assets.find((a) => a.kind === "audio")!;
  analyses.push(capture.analyses.find((a) => a.assetId === music.id)!);
  await page.goto("/");
  for (const asset of [voice, music])
    await page.evaluate(
      async ({ asset, bytes }) => {
        const m = "/packages/platform/storage.ts";
        const { writeLocal } = await import(m);
        await writeLocal(
          "media",
          `${asset.id}:${asset.fingerprint}`,
          new Blob([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], {
            type: asset.kind === "audio" ? "audio/wav" : "video/mp4",
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
      const { newProject } = await import(sm),
        { useEditor } = await import(em),
        { writeDerived } = await import(dm);
      const p = newProject("Speech-aware audio acceptance", 320, 180);
      p.assets = assets;
      for (const a of analyses)
        await writeDerived(
          `analysis-v1:${a.assetId}:${a.fingerprint}:${a.settings.task}`,
          a,
          JSON.stringify(a).length * 2,
        );
      useEditor.getState().load(p);
    },
    { assets: [voice, music], analyses },
  );
  const state = async (p = page) =>
    p.evaluate(async () => {
      const m = "/packages/editor-state/index.ts";
      return (await import(m)).useEditor.getState().project;
    });
  const original = await state();
  await page.getByRole("button", { name: "AI Studio", exact: true }).click();
  await page
    .getByLabel("Describe your edit")
    .fill(
      "Create a 12-second gym Reel in 16:9 with music, speed ramps and captions.",
    );
  await page
    .getByRole("button", { name: "Preview edit plan", exact: true })
    .click();
  const review = page.getByRole("region", { name: "Gym edit plan" });
  await expect(
    review.getByRole("button", { name: "Apply AI edit", exact: true }),
  ).toBeEnabled({ timeout: 45000 });
  await expect(review).toContainText("speech ranges duck music");
  expect((await state()).compositions).toHaveLength(0);
  await review
    .getByRole("button", { name: "Play sequence preview", exact: true })
    .click();
  await expect
    .poll(() => review.getByLabel("Gym preview frame").inputValue())
    .not.toBe("0");
  await review
    .getByRole("button", { name: "Pause preview", exact: true })
    .click();
  await review
    .getByRole("button", { name: "Apply AI edit", exact: true })
    .click();
  const applied = await state(),
    sequence = applied.compositions[0];
  expect(sequence.layers.some((l: any) => l.kind === "text")).toBe(true);
  expect(
    sequence.layers.find((l: any) => l.assetId === music.id).keyframes.gain
      .length,
  ).toBeGreaterThan(4);
  await review
    .getByRole("button", { name: "Undo AI edit", exact: true })
    .click();
  expect(await state()).toEqual(original);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect(await state()).toEqual(applied);
  await page.getByLabel("Active sequence").selectOption(sequence.id);
  for (const request of [
    "Remove the ducking.",
    "Lower the music when I speak.",
  ]) {
    await page.getByLabel("Describe your edit").fill(request);
    await page
      .getByRole("button", { name: "Preview edit plan", exact: true })
      .click();
    const revision = page.getByRole("region", { name: "AI revision plan" });
    await expect(
      revision.getByRole("button", { name: "Apply revision", exact: true }),
    ).toBeEnabled({ timeout: 30000 });
    await revision
      .getByRole("button", { name: "Apply revision", exact: true })
      .click();
  }
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const musicId = sequence.layers.find((l: any) => l.assetId === music.id).id;
  await page.evaluate(
    async ({ musicId }) => {
      const em = "/packages/editor-state/index.ts",
        cm = "/packages/engine/clock.ts";
      const { useEditor } = await import(em),
        { clock } = await import(cm);
      clock.seek(90);
      useEditor.getState().select(musicId);
    },
    { musicId },
  );
  await page.getByLabel("Clip gain (dB)", { exact: true }).fill("-17.25");
  await page.getByLabel("Clip gain (dB)", { exact: true }).press("Tab");
  const edited = await state();
  expect(
    edited.compositions[0].layers
      .find((l: any) => l.id === musicId)
      .keyframes.gain.find((k: any) => k.frame === 90).value,
  ).toBe(-17.25);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  const saved = await fs.readFile((await download.path())!, "utf8");
  await fs.writeFile(path.join(dir, "EDITABLE.supp"), saved);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/");
  await reopened
    .getByTestId("project-input")
    .setInputFiles({
      name: "AUDIO.supp",
      mimeType: "application/json",
      buffer: Buffer.from(saved),
    });
  expect((await state(reopened)).compositions).toEqual(edited.compositions);
  await reopened.getByLabel("Active sequence").selectOption(sequence.id);
  await reopened.exposeFunction(
    "saveAudioFrame",
    async (frame: number, png: string) =>
      fs.writeFile(
        path.join(dir, `${frame}.png`),
        Buffer.from(png.split(",")[1], "base64"),
      ),
  );
  const snapshot = await reopened.evaluate(async () => {
    const cm = "/packages/commands/sequences.ts",
      em = "/packages/editor-state/index.ts",
      rm = "/packages/engine/compositor.ts",
      sm = "/packages/project-schema/index.ts";
    const { sequenceExportSnapshot } = await import(cm),
      { useEditor } = await import(em),
      { Compositor } = await import(rm),
      { duration } = await import(sm);
    const s = useEditor.getState(),
      p = sequenceExportSnapshot(s.project, s.activeComposition),
      canvas = document.createElement("canvas"),
      r = new Compositor(canvas, true, { renderer: "cpu" });
    try {
      for (let f = 0; f < duration(p); f++) {
        const error = await r.render(p, f, false, 1, true);
        if (error) throw error;
        await (window as any).saveAudioFrame(f, canvas.toDataURL("image/png"));
      }
    } finally {
      await r.dispose();
    }
    return p;
  });
  await fs.writeFile(path.join(dir, "project.supp"), JSON.stringify(snapshot));
  await reopened.screenshot({ path: path.join(dir, "reopened.png") });
});
