import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
test("renders imported video, image, animated title, mask, grade, and mixed audio", async ({
  page,
}) => {
  await page.goto("/");
  const files = ["footage.mp4", "tone.wav", "still.png"].map((name) =>
    path.resolve("test-results/fixtures", name),
  );
  await page.getByTestId("media-input").setInputFiles(files);
  await expect(page.getByLabel("Preview still.png")).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  const saved = JSON.parse(await fs.readFile((await download.path())!, "utf8"));
  const result = await page.evaluate(
    async ({ files, saved }) => {
      const a = "/packages/project-schema/index.ts",
        c = "/packages/engine/compositor.ts";
      const { newProject, newTrack, newClip, parseProject } = await import(a),
        { Compositor } = await import(c);
      const p = newProject("Verified mixed-media edit", 320, 180);
      p.assets = structuredClone(saved.assets);
      const video = p.assets.find((a: { kind: string }) => a.kind === "video"),
        image = p.assets.find((a: { kind: string }) => a.kind === "image"),
        audio = p.assets.find((a: { kind: string }) => a.kind === "audio");
      const titleTrack = newTrack("video", 3),
        imageTrack = newTrack("video", 2);
      p.tracks.unshift(imageTrack);
      p.tracks.unshift(titleTrack);
      const base = newClip(p.tracks[2].id, 0, 60, "media", video);
      base.sourceIn = 20;
      base.effects = {
        blur: 0.4,
        brightness: 1.15,
        contrast: 1.1,
        saturation: 0.65,
      };
      base.gain = -18;
      const overlay = newClip(imageTrack.id, 0, 60, "media", image);
      overlay.transform = {
        x: 80,
        y: -35,
        scale: 0.35,
        rotation: 8,
        opacity: 0.85,
      };
      overlay.mask = { type: "ellipse", x: 0, y: 0, width: 1, height: 1 };
      const title = newClip(titleTrack.id, 0, 60, "text");
      title.text = {
        content: "supp.edit / first cut",
        size: 21,
        color: "#ffffff",
        font: "sans-serif",
        weight: "bold",
        align: "center",
      };
      title.transform.y = 47;
      title.keyframes.x = [
        { frame: 0, value: -35, easing: "ease-in-out" },
        { frame: 59, value: 35, easing: "linear" },
      ];
      const sound = newClip(p.tracks[3].id, 6, 48, "media", audio);
      sound.sourceIn = 6;
      sound.gain = -12;
      p.clips = [base, overlay, title, sound];
      // Save/reopen the graph before rendering. Resource blobs remain external in IndexedDB.
      const reopened = parseProject(JSON.parse(JSON.stringify(p)));
      const canvas = document.createElement("canvas"),
        renderer = new Compositor(canvas, true),
        frames: string[] = [];
      for (let f = 0; f < 60; f++) {
        await renderer.render(reopened, f, false, 1, true);
        frames.push(canvas.toDataURL("image/png").split(",")[1]);
      }
      await renderer.dispose();
      const native = structuredClone(reopened);
      native.assets.forEach((a: { path: string; name: string }) => {
        a.path = files.find((f) => f.endsWith(a.name))!;
      });
      return { project: native, browserProject: reopened, frames };
    },
    { files, saved },
  );
  expect(result.frames).toHaveLength(60);
  expect(result.frames[0]).not.toBe(result.frames[59]);
  const directory = path.resolve("test-results/render-media");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, "project.supp"),
    JSON.stringify(result.project),
  );
  for (let i = 0; i < result.frames.length; i++)
    await fs.writeFile(
      path.join(directory, `${i}.png`),
      Buffer.from(result.frames[i], "base64"),
    );
  await page.getByTestId("project-input").setInputFiles({
    name: "render.supp",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(result.browserProject)),
  });
  await page.locator(".ruler-ticks").click({ position: { x: 45, y: 15 } });
  await page.getByRole("button", { name: "Clip Your title" }).click();
  await page.screenshot({
    path: "test-results/mixed-media-editor.png",
    fullPage: true,
  });
});
