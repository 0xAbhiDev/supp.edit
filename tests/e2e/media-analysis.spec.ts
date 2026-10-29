import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
test("actual local speech results drive transcript selection, captions and reversible ripple cuts", async ({
  page,
}) => {
  const result = JSON.parse(
    await fs.readFile("work/analysis-acceptance/jfk-speech.json", "utf8"),
  );
  const wav = await fs.readFile("work/whisper/jfk.wav");
  expect(
    result.transcript.segments.map((s: { text: string }) => s.text).join(" "),
  ).toMatch(/country/i);
  await page.goto("/");
  const original = await page.evaluate(
    async ({ result, bytes }) => {
      const sm = "/packages/project-schema/index.ts",
        storage = "/packages/platform/storage.ts",
        derived = "/packages/platform/derived.ts",
        editor = "/packages/editor-state/index.ts";
      const { newProject, newClip } = await import(sm),
        { writeLocal } = await import(storage),
        { writeDerived } = await import(derived),
        { useEditor } = await import(editor);
      const p = newProject("Real speech acceptance", 320, 180);
      const asset = {
        id: result.assetId,
        name: "JFK speech",
        kind: "audio",
        path: "jfk.wav",
        size: bytes.length,
        duration: result.durationMs / 1000,
        width: 0,
        height: 0,
        fps: 0,
        codec: "pcm_s16le",
        hasAudio: true,
        fingerprint: result.fingerprint,
      };
      p.assets = [asset];
      const track = p.tracks.find((t: { kind: string }) => t.kind === "audio");
      const clip = newClip(
        track.id,
        0,
        Math.floor(asset.duration * 30),
        "media",
        asset,
      );
      p.clips = [clip];
      await writeLocal(
        "media",
        `${asset.id}:${asset.fingerprint}`,
        new Blob([new Uint8Array(bytes)], { type: "audio/wav" }),
      );
      await writeDerived(
        `analysis-v1:${asset.id}:${asset.fingerprint}:speech`,
        result,
        JSON.stringify(result).length * 2,
      );
      useEditor.getState().load(p);
      useEditor.getState().select(clip.id);
      return p;
    },
    { result, bytes: [...wav] },
  );
  await page.getByRole("button", { name: "AI Studio", exact: true }).click();
  const panel = page.getByRole("region", { name: "Media understanding" });
  await expect(
    panel.getByRole("button", {
      name: "Preview transcript import",
      exact: true,
    }),
  ).toBeEnabled();
  await panel
    .getByRole("button", { name: "Preview transcript import", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Apply analysis edit", exact: true })
    .click();
  const state = () =>
    page.evaluate(async () => {
      const m = "/packages/editor-state/index.ts";
      return (await import(m)).useEditor.getState().project;
    });
  expect(
    (await state()).transcripts[0].segments[0].words.length,
  ).toBeGreaterThan(10);
  await panel.getByLabel("Search transcript").fill("country");
  await expect(panel.locator(".analysis-transcript")).toContainText("country");
  await panel.getByLabel("Search transcript").fill("");
  const word = panel
    .locator(".word")
    .filter({ hasText: /^country[,\.]?\s*$/ })
    .first();
  await word.click();
  await expect
    .poll(() =>
      panel
        .getByLabel("Analysis source player")
        .evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeGreaterThan(1);
  await panel
    .getByRole("button", { name: "Preview ripple delete", exact: true })
    .click();
  const before = await state();
  expect(before.clips).toEqual(original.clips);
  await panel
    .getByRole("button", { name: "Apply analysis edit", exact: true })
    .click();
  const cut = await state();
  expect(cut.clips.length).toBe(2);
  expect(
    cut.clips.reduce((n: number, c: { duration: number }) => n + c.duration, 0),
  ).toBeLessThan(original.clips[0].duration);
  await panel
    .getByRole("button", { name: "Undo analysis edit", exact: true })
    .click();
  expect((await state()).clips).toEqual(original.clips);
  await panel
    .getByRole("button", { name: "Preview speech captions", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "Apply analysis edit", exact: true })
    .click();
  const captioned = await state();
  expect(
    captioned.clips.filter((c: { kind: string }) => c.kind === "text").length,
  ).toBeGreaterThan(0);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  const saved = await fs.readFile((await download.path())!, "utf8");
  await fs.mkdir("test-results/analysis", { recursive: true });
  await fs.writeFile("test-results/analysis/TRANSCRIPTION_TEST.supp", saved);
  await page.getByTestId("project-input").setInputFiles({
    name: "speech.supp",
    mimeType: "application/json",
    buffer: Buffer.from(saved),
  });
  expect((await state()).transcripts).toEqual(captioned.transcripts);
  await panel
    .getByRole("heading", { name: /Transcript ·/ })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "test-results/analysis/transcript-ui.png",
    fullPage: true,
  });
});
