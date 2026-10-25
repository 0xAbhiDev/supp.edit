import { describe, it, expect } from "vitest";
import { newProject, parseProject } from "../packages/project-schema";
import { History } from "../packages/commands";
import { AIStudioService, resolveIntent } from "../packages/ai/studio";
import {
  captionPreviewEdit,
  isCaptionPreviewCurrent,
} from "../packages/ai/captions";
import { snapshotContext } from "../packages/ai/context";
import { parseSrt } from "../packages/ai/srt";
import { AIModelManager, captionModel } from "../packages/ai/models";
import { CloudAuthorizationGate } from "../packages/ai/privacy";
import type { CloudRequest } from "../packages/ai/privacy";
import { JobScheduler } from "../packages/jobs";
const srt =
  "1\n00:00:00,000 --> 00:00:01,000\nHello\n\n2\n00:00:01,000 --> 00:00:02,000\nWorld";
const tick = () => new Promise((r) => setTimeout(r, 0));
async function completed(service: AIStudioService) {
  for (let i = 0; i < 50 && !service.getSnapshot()[0]?.preview; i++)
    await tick();
  const e = service.getSnapshot()[0];
  expect(e?.preview).toBeTruthy();
  return e;
}

describe("AI foundation", () => {
  it("parses timestamps, rejects invalid and overlapping cues", () => {
    expect(parseSrt(srt).segments[1].startMs).toBe(1000);
    expect(() =>
      parseSrt(srt.replace("00:00:01,000\nHello", "00:00:00,000\nHello")),
    ).toThrow();
    expect(() =>
      parseSrt(srt.replace("00:00:01,000 -->", "00:00:00,500 -->")),
    ).toThrow(/Overlapping/);
    expect(() => parseSrt("fake completion")).toThrow();
  });
  it("plans only implemented commands and snapshots no paths or transcript text", () => {
    expect(resolveIntent("Generate captions")).toBe("captions-from-transcript");
    expect(() => resolveIntent("remove the background")).toThrow(
      /no installed backend/,
    );
    const p = newProject();
    p.assets.push({
      id: "asset",
      name: "private",
      kind: "video",
      path: "C:/secret/file.mp4",
      size: 5,
      duration: 3,
      width: 100,
      height: 100,
      fps: 30,
      codec: "h264",
      hasAudio: true,
      fingerprint: "private",
    });
    p.transcripts.push(parseSrt(srt));
    const context = snapshotContext(p, 2);
    expect(JSON.stringify(context)).not.toMatch(
      /secret|private|Hello|fingerprint|path/,
    );
    expect(Object.isFrozen(context.media)).toBe(true);
    expect(p.assets[0].path).toContain("secret");
    expect(new AIStudioService().supports("Transcribe")).toBe(false);
  });
  it("creates real text layers and persisted transcripts through one history command", async () => {
    const p = newProject("Captions", 320, 180),
      service = new AIStudioService(new JobScheduler());
    await service.submit("generate captions", srt, p, 4, {}, 10);
    const entry = await completed(service),
      preview = entry.preview!;
    expect(p.clips).toHaveLength(0);
    expect(p.transcripts).toHaveLength(0);
    expect(
      preview.clips.map((c) => [c.start, c.duration, c.text.content]),
    ).toEqual([
      [10, 30, "Hello"],
      [40, 30, "World"],
    ]);
    const h = new History(p),
      next = h.execute(p, "captions", captionPreviewEdit(preview, p, 4));
    expect(next.transcripts[0].segments).toHaveLength(2);
    expect(next.clips.every((c) => c.kind === "text")).toBe(true);
    expect(parseProject(JSON.parse(JSON.stringify(next)))).toEqual(next);
    expect(h.undo(next)).toEqual(p);
    expect(h.redo(p)).toEqual(next);
    expect(() => captionPreviewEdit(preview, next, 5)).toThrow(/changed/);
    expect(isCaptionPreviewCurrent(preview, p, 5)).toBe(false);
    expect(isCaptionPreviewCurrent(preview, structuredClone(p), 4)).toBe(false);
  });
  it("model metadata never downloads and refuses unsupported devices", () => {
    const models = new AIModelManager();
    models.register(captionModel);
    expect(models.get(captionModel.id).download.state).toBe("not-requested");
    expect(() => models.selectDevice(captionModel.id, "CUDA")).toThrow(
      /unavailable/,
    );
    expect(() =>
      models.reportRuntimeState(captionModel.id, {
        installedState: "installed",
        download: { state: "downloading", receivedBytes: 10, totalBytes: 2 },
      }),
    ).toThrow(/total/);
  });
  it("binds explicit cloud consent to endpoint, source, project and one use", async () => {
    const p = newProject(),
      service = new AIStudioService();
    await service.submit("generate captions", srt, p, 0);
    const entry = await completed(service),
      context = snapshotContext(p, 0);
    const request: CloudRequest = {
      context,
      operation: {
        ...entry.plan.operation,
        contextSnapshotId: context.snapshotId,
        providerId: "cloud",
        modelId: "remote-v1",
      },
      provider: {
        id: "cloud",
        name: "Configured provider",
        version: "1",
        type: "Remote API",
        processing: "CLOUD",
        endpointOrigin: "https://example.com",
      },
      model: {
        ...captionModel,
        id: "remote-v1",
        providerId: "cloud",
        runtime: "remote-api",
        installedState: "remote",
        executionDevice: "remote",
        supportedDevices: ["remote"],
      },
      disclosures: ["project-context", "transcript-text"],
    };
    const gate = new CloudAuthorizationGate();
    await expect(gate.consume(undefined, request)).rejects.toThrow(/missing/);
    const disclosure = await gate.prepare(request);
    expect(disclosure.processing).toBe("CLOUD");
    expect(() => gate.confirm(disclosure.id, false)).toThrow(/confirmation/);
    const grant = gate.confirm((await gate.prepare(request)).id, true);
    await gate.consume(grant, request);
    await expect(gate.consume(grant, request)).rejects.toThrow(/used/);
    const next = gate.confirm((await gate.prepare(request)).id, true);
    await expect(
      gate.consume(next, {
        ...request,
        context: { ...request.context, projectName: "Changed" },
      }),
    ).rejects.toThrow(/changed/);
    await expect(
      gate.prepare({ ...request, disclosures: ["project-context"] }),
    ).rejects.toThrow(/Transcript/);
    const mediaRequest = {
      ...request,
      operation: {
        ...request.operation,
        sources: [
          {
            kind: "media" as const,
            assetId: "asset",
            contentDigest: "a".repeat(64),
          },
        ],
      },
    };
    await expect(gate.prepare(mediaRequest)).rejects.toThrow(/Media upload/);
  });
});

describe("shared background jobs", () => {
  it("cancels queued/running work and discards late results", async () => {
    const queue = new JobScheduler();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const running = queue.enqueue({
      label: "held",
      scope: "p",
      run: async () => {
        await held;
        return "late";
      },
    });
    const queued = queue.enqueue({
      label: "queued",
      scope: "p",
      run: async () => "never",
    });
    await tick();
    expect(queue.getSnapshot().map((j) => j.state)).toEqual([
      "Running",
      "Queued",
    ]);
    queue.cancel(queued.id);
    queue.cancel(running.id);
    release();
    expect(await running.finished).toEqual({ state: "Cancelled" });
    expect(await queued.finished).toEqual({ state: "Cancelled" });
    await tick();
    expect(queue.getSnapshot().every((j) => j.state === "Cancelled")).toBe(
      true,
    );
  });
  it("pauses at a checkpoint and resumes real progress", async () => {
    const queue = new JobScheduler();
    let begin!: () => void;
    const gate = new Promise<void>((r) => (begin = r));
    const job = queue.enqueue({
      label: "work",
      scope: "p",
      supportsPause: true,
      run: async (ctx) => {
        await gate;
        await ctx.checkpoint();
        ctx.report({ completed: 1, total: 1, unit: "items" });
        return 42;
      },
    });
    await tick();
    expect(queue.pause(job.id)).toBe(true);
    begin();
    await tick();
    expect(queue.getSnapshot()[0].state).toBe("Paused");
    queue.resume(job.id);
    expect(await job.finished).toEqual({ state: "Completed", result: 42 });
    expect(queue.getSnapshot()[0].progress?.completed).toBe(1);
  });
  it("records failures and rejects fictitious progress", async () => {
    const queue = new JobScheduler();
    const job = queue.enqueue({
      label: "bad",
      scope: "p",
      run: async (ctx) => {
        ctx.report({ completed: 2, total: 1, unit: "frames" });
      },
    });
    expect((await job.finished).state).toBe("Failed");
    expect(queue.pause(job.id)).toBe(false);
  });
});
