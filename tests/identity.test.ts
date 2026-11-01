import { it, expect } from "vitest";
import { identitySchema } from "../packages/project-schema/identity";
import {
  assetSchema,
  newProject,
  parseProject,
} from "../packages/project-schema";
it("preserves opaque non-UUID asset IDs and shares the native UTF-16 length contract", () => {
  for (const id of [
    "legacy-asset",
    "a/b",
    "素材",
    "123",
    "素".repeat(128),
    "🖼".repeat(64),
  ]) {
    expect(identitySchema.parse(id)).toBe(id);
    const p = newProject();
    p.assets = [
      assetSchema.parse({
        id,
        name: "clip",
        kind: "video",
        path: "clip.mp4",
        size: 1,
        duration: 3,
        width: 320,
        height: 180,
        fps: 30,
        codec: "h264",
        hasAudio: false,
        fingerprint: "source",
      }),
    ];
    expect(parseProject(JSON.parse(JSON.stringify(p))).assets[0].id).toBe(id);
  }
  for (const id of ["", "x".repeat(129), "🖼".repeat(65), null, 12])
    expect(identitySchema.safeParse(id).success).toBe(false);
});
