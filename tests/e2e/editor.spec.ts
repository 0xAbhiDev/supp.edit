import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
const media = path.resolve("test-results/fixtures");
test("real editing, rendering, serialization, and crash recovery", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByText("A blank canvas.")).toBeVisible();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Integration edit");
  await page.getByLabel("Project canvas").selectOption("1280x720");
  await page.getByRole("button", { name: "Create project" }).click();
  await page
    .getByTestId("media-input")
    .setInputFiles([
      path.join(media, "footage.mp4"),
      path.join(media, "tone.wav"),
      path.join(media, "still.png"),
    ]);
  await expect(page.getByLabel("Preview footage.mp4")).toBeVisible();
  await expect(page.getByLabel("Preview tone.wav")).toBeVisible();
  await page
    .getByLabel("Preview footage.mp4")
    .dragTo(page.locator(".track-lane").first(), {
      targetPosition: { x: 10, y: 25 },
    });
  await expect(
    page.getByRole("button", { name: "Clip footage.mp4" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("s");
  await expect(
    page.getByRole("button", { name: "Clip footage.mp4" }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Clip footage.mp4" }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Clip footage.mp4" }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "Title", exact: true }).click();
  await page.getByLabel("Title text").fill("A real first cut");
  await page.getByLabel("Font size", { exact: true }).fill("84");
  await page.getByLabel("Gaussian blur").fill("1.5");
  await page.getByLabel("Toggle Position X keyframe").click();
  await page.keyboard.press("Tab");
  await page.locator(".ruler-ticks").click({ position: { x: 75, y: 15 } });
  await page.getByLabel("Position X", { exact: true }).fill("120");
  await page.locator("summary").filter({ hasText: "Layer mask" }).click();
  await page.getByLabel("Mask type").selectOption("ellipse");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save project", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("Integration edit.supp");
  const snapshot = JSON.parse(
    await fs.readFile((await download.path())!, "utf8"),
  );
  expect(snapshot.clips.length).toBe(3);
  expect(snapshot.clips.at(-1)?.text.content).toBe("A real first cut");
  expect(snapshot.clips.at(-1)?.keyframes.x.length).toBe(2);
  expect(snapshot.clips.at(-1)?.mask?.type).toBe("ellipse");
  const serialized = JSON.stringify(snapshot);
  await page.getByTestId("project-input").setInputFiles({
    name: "test.supp",
    mimeType: "application/json",
    buffer: Buffer.from(serialized),
  });
  await expect(
    page.getByRole("button", { name: "Clip A real first cut" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clip A real first cut" }).click();
  await expect(page.getByLabel("Gaussian blur")).toHaveValue("1.5");
  await page.getByLabel("Title text").fill("Recovered title");
  await expect(page.getByText(/Recovery saved/)).toBeVisible();
  await page.waitForTimeout(1800);
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "Recover your work" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore project" }).click();
  await expect(
    page.getByRole("button", { name: "Clip Recovered title" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/editor.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("compositor outputs real transformed pixels and a native export frame set", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const schemaPath = "/packages/project-schema/index.ts",
      enginePath = "/packages/engine/compositor.ts";
    const { newProject, newClip } = await import(schemaPath);
    const { Compositor } = await import(enginePath);
    const p = newProject("Render regression", 320, 180),
      clip = newClip(p.tracks[0].id, 0, 12, "shape");
    clip.shape = { type: "rectangle", color: "#ff0000", width: 80, height: 80 };
    clip.keyframes.x = [
      { frame: 0, value: -60, easing: "linear" },
      { frame: 11, value: 60, easing: "linear" },
    ];
    p.clips = [clip];
    const canvas = document.createElement("canvas"),
      r = new Compositor(canvas, true),
      frames: string[] = [];
    await r.render(p, 0, false, 1, true);
    const ctx = canvas.getContext("2d")!;
    const start = Array.from(ctx.getImageData(100, 90, 1, 1).data);
    const background = Array.from(ctx.getImageData(240, 90, 1, 1).data);
    for (let f = 0; f < 12; f++) {
      await r.render(p, f, false, 1, true);
      frames.push(canvas.toDataURL("image/png").split(",")[1]);
    }
    await r.dispose();
    return { project: p, frames, start, background };
  });
  expect(result.start.slice(0, 3)).toEqual([255, 0, 0]);
  expect(result.background.slice(0, 3)).toEqual([0, 0, 0]);
  const directory = path.resolve("test-results/render");
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
});
