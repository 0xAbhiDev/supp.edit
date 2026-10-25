import { invoke } from "@tauri-apps/api/core";
import { type Project, duration, parseProject } from "../project-schema";
import { desktop } from "../platform";
import { Compositor } from "./compositor";
import { usePlayback } from "./diagnostics";
export type RenderProgress = {
  status: "rendering" | "encoding" | "complete" | "cancelled";
  frame: number;
  total: number;
  path: string;
  elapsed: number;
};
export async function exportMp4(
  project: Project,
  onProgress: (p: RenderProgress) => void,
  signal: AbortSignal,
) {
  if (!desktop)
    throw new Error(
      "MP4 export requires the desktop app and FFmpeg. Web companion supports PNG frame export.",
    );
  const snapshot = parseProject(structuredClone(project)),
    path = await invoke<string | null>("begin_export", { project: snapshot });
  if (!path) return null;
  const canvas = document.createElement("canvas"),
    renderer = new Compositor(canvas, true, {
      renderer: usePlayback.getState().mode,
    }),
    total = duration(snapshot),
    start = performance.now();
  try {
    for (let frame = 0; frame < total; frame++) {
      if (signal.aborted)
        throw new DOMException("Render cancelled", "AbortError");
      await renderer.render(snapshot, frame, false, 1, true);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Frame encoding failed"))),
          "image/png",
        ),
      );
      await invoke("write_frame", await blob.arrayBuffer());
      onProgress({
        status: "rendering",
        frame: frame + 1,
        total,
        path,
        elapsed: (performance.now() - start) / 1000,
      });
    }
    if (signal.aborted)
      throw new DOMException("Render cancelled", "AbortError");
    onProgress({
      status: "encoding",
      frame: total,
      total,
      path,
      elapsed: (performance.now() - start) / 1000,
    });
    await invoke("finish_export");
    onProgress({
      status: "complete",
      frame: total,
      total,
      path,
      elapsed: (performance.now() - start) / 1000,
    });
    return path;
  } catch (error) {
    await invoke("cancel_export");
    if (error instanceof DOMException && error.name === "AbortError")
      onProgress({
        status: "cancelled",
        frame: 0,
        total,
        path,
        elapsed: (performance.now() - start) / 1000,
      });
    else throw error;
    return null;
  } finally {
    await renderer.dispose();
  }
}
