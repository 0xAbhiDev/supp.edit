import { z } from "zod";
import { compositionView } from "../../commands/compositions";
import { type Project, uid } from "../../project-schema";
import { backgroundJobs, type JobScheduler } from "../../jobs";
import {
  snapshotContext,
  type AIProjectContext,
  type ContextSelection,
} from "../context";
import { type EditorToolCall } from "./registry";
import { previewEditPlan, type EditorPlan } from "./execution";
export interface EditingIntent {
  summary: string;
  commands: EditorToolCall[];
}
/** A provider adapter must resolve intent into validated tools, never executable code. Cloud adapters require a separate privacy-gated transport. */
export interface IntentInterpreter {
  readonly id: string;
  readonly processing: "LOCAL";
  interpret(request: string, context: AIProjectContext): Promise<EditingIntent>;
}
const requestSchema = z.string().trim().min(1).max(4000);
export const localCommandInterpreter: IntentInterpreter = {
  id: "local-precise-commands",
  processing: "LOCAL",
  async interpret(input, context) {
    const request = requestSchema.parse(input).replace(/[.!]$/, "");
    const clipId = context.selectedLayerId;
    if (!clipId) throw new Error("Select a layer to plan a supported edit.");
    let match = request.match(
      /^(?:add|set) (blur|brightness|contrast|saturation)(?: to)? ([0-9]+(?:\.[0-9]+)?)(?: on (?:the )?selected (?:clip|layer))?$/i,
    );
    if (match) {
      const type = match[1].toLowerCase() as
          "blur" | "brightness" | "contrast" | "saturation",
        value = Number(match[2]);
      const existing =
        context.effectStacks
          .find((s) => s.layerId === clipId)
          ?.entries.filter((e) => e.type === type) ?? [];
      if (/^set /i.test(request) && existing.length) {
        if (existing.length !== 1)
          throw new Error(
            "Several effects of that type exist. Select the exact effect manually before revising it.",
          );
        return {
          summary: `Set existing ${type} to ${value}`,
          commands: [
            {
              tool: "effect.update",
              clipId,
              effectId: existing[0].id,
              value,
              frame: context.frame,
            },
          ],
        };
      }
      return {
        summary: `Add ${type} ${value} to the selected layer`,
        commands: [
          { tool: "effect.add", clipId, effectId: uid(), type, value },
        ],
      };
    }
    match = request.match(
      /^move (?:the )?selected (?:clip|layer) to frame (\d+)$/i,
    );
    if (match)
      return {
        summary: `Move selected layer to frame ${match[1]}`,
        commands: [{ tool: "clip.move", clipId, startFrame: Number(match[1]) }],
      };
    match = request.match(
      /^trim (?:the )?selected (?:clip|layer) (start|end) to frame (\d+)$/i,
    );
    if (match)
      return {
        summary: `Trim selected layer ${match[1]} to frame ${match[2]}`,
        commands: [
          {
            tool: "clip.trim",
            clipId,
            edge: match[1].toLowerCase() === "start" ? "in" : "out",
            targetFrame: Number(match[2]),
          },
        ],
      };
    throw new Error(
      "This local planner supports precise effect, move and trim commands. Creative rough cuts, speech/vision analysis and beat synchronization need backends that are not installed yet. No edit was made.",
    );
  },
};
export class AIEditorAgent {
  constructor(
    readonly interpreter: IntentInterpreter = localCommandInterpreter,
    readonly jobs: JobScheduler = backgroundJobs,
  ) {}
  plan(
    request: string,
    project: Project,
    revision: number,
    selection: ContextSelection = {},
  ) {
    const scope = selection.activeCompositionId ?? null;
    const comp = scope
      ? project.compositions.find((c) => c.id === scope)
      : null;
    if (scope && !comp) throw Error("The selected sequence no longer exists");
    const view = compositionView(project, scope);
    const context = snapshotContext(
      { ...view, name: project.name },
      revision,
      selection,
      {
        snapshot: () =>
          comp
            ? {
                id: comp.id,
                width: comp.settings.width,
                height: comp.settings.height,
                durationFrames: comp.duration,
                layerIds: comp.layers.map((c) => c.id),
              }
            : null,
      },
    );
    return this.jobs.enqueue({
      label: "Plan project edit",
      scope: project.id,
      supportsPause: false,
      run: async (job) => {
        await job.checkpoint();
        const intent = await this.interpreter.interpret(request, context);
        await job.checkpoint();
        const plan: EditorPlan = {
          id: uid(),
          projectId: project.id,
          revision,
          compositionId: scope,
          summary: intent.summary,
          processing: "LOCAL",
          commands: intent.commands,
        };
        const preview = previewEditPlan(plan, project, revision);
        job.report({
          completed: preview.plan.commands.length,
          total: preview.plan.commands.length,
          unit: "commands validated",
        });
        return preview;
      },
    });
  }
}
export const aiEditorAgent = new AIEditorAgent();
