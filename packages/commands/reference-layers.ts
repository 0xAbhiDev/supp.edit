import { z } from "zod";
import { newClip, newTrack } from "../project-schema";
import { bezierMaskSchema } from "../masks/model";
import { editable, type Edit } from "./index";
import { resolveClip } from "../animation";

const id = z.string().min(1).max(118);
const common = { sequenceId: id, id, sourceId: id, trackId: id };
export const backgroundFillSchema = z
  .object({
    tool: z.literal("sequence.backgroundFill"),
    ...common,
    blur: z.number().min(0).max(100),
  })
  .strict();
export const subjectLayerSchema = z
  .object({
    tool: z.literal("sequence.subjectLayer"),
    ...common,
    mask: bezierMaskSchema,
    silhouette: z.object({
      color: z.string().regex(/^#[0-9a-f]{6}$/i),
      spans: z.array(z.object({start:z.number().int().nonnegative(),end:z.number().int().positive()}).strict()).min(1).max(300)
    }).strict().optional(),
  })
  .strict();

export const plateTintSchema=z.object({tool:z.literal("sequence.plateTint"),...common,color:z.string().regex(/^#[0-9a-f]{6}$/i),strength:z.number().min(0).max(1),
  // "shadow-cast" multiplies through the raw shot's inverted luminance: shadows and midtones
  // take the cast, highlights stay near neutral. "color" is a flat hue wash.
  // "highlight-cast" is a plain multiply over the shot: a white balance.
  treatment:z.enum(["color","shadow-cast","highlight-cast"]).optional()}).strict();
export function referencePlateTint(input:z.infer<typeof plateTintSchema>):Edit{
  const call=plateTintSchema.parse(input);
  return p=>{
    const source=editable(p,call.sourceId);
    if(!source || source.kind!=="media" || !p.assets.some(a=>a.id===source.assetId && a.kind==="video"))throw Error("Choose an unlocked raw video for the measured color treatment.");
    if(p.clips.some(c=>c.id===call.id))throw Error("Grade layer already exists.");
    const sourceOrder=p.tracks.findIndex(t=>t.id===source.trackId);
    let track=p.tracks.find(t=>t.id===call.trackId);
    if(track && (track.locked || track.kind!=="video" || p.tracks.indexOf(track)>=sourceOrder))throw Error("Grade track must be above the source.");
    if(!track){track={...newTrack("video",p.tracks.length+1),name:call.treatment==="highlight-cast"?"Reference highlight cast":"Reference color cast",id:call.trackId};p.tracks.splice(sourceOrder,0,track);}
    const tint=newClip(track.id,source.start,source.duration,"shape");
    const cast=call.treatment==="shadow-cast", balance=call.treatment==="highlight-cast";
    tint.id=call.id;tint.name=cast?"Measured shadow cast":balance?"Measured highlight cast":"Measured plate tint";tint.blendMode=cast||balance?"multiply":"color";tint.transform.opacity=call.strength;
    tint.shape={type:"rectangle",color:call.color,width:p.settings.width,height:p.settings.height};
    tint.matte={layerId:source.id,mode:cast?"luma-inverted":"alpha",keepSourceVisible:true};
    p.clips.push(tint);
  };
}

/** Copies retain source timing and grading. All new state uses ordinary editable layers. */
export function referenceLayer(
  input:
    z.infer<typeof backgroundFillSchema> | z.infer<typeof subjectLayerSchema>,
): Edit {
  const call =
    input.tool === "sequence.backgroundFill"
      ? backgroundFillSchema.parse(input)
      : subjectLayerSchema.parse(input);
  return (p) => {
    const source = editable(p, call.sourceId);
    const asset = p.assets.find(
      (a) => a.id === source?.assetId && a.kind === "video",
    );
    if (!source || source.kind !== "media" || !asset)
      throw Error("A reference layer requires an unlocked raw video clip");
    if (p.clips.some((c) => c.id === call.id))
      throw Error("Reference layer already exists");
    const background = call.tool === "sequence.backgroundFill";
    let track = p.tracks.find((t) => t.id === call.trackId);
    if (track && (track.locked || track.kind !== "video" || !track.muted))
      throw Error("Reference helper track must be unlocked, video and muted");
    const sourceOrder = p.tracks.findIndex((t) => t.id === source.trackId);
    if (
      track &&
      (background
        ? p.tracks.indexOf(track) <= sourceOrder
        : p.tracks.indexOf(track) >= sourceOrder)
    )
      throw Error("Reference layer track has an invalid draw order");
    if (!track) {
      track = {
        ...newTrack("video", p.tracks.length + 1),
        id: call.trackId,
        muted: true,
        name: background ? "Background fill" : "Foreground people",
      };
      p.tracks.splice(background ? sourceOrder + 1 : 0, 0, track);
    }
    // Immer draft proxies cannot be structuredClone'd.
    const copy = JSON.parse(JSON.stringify(source)) as typeof source;
    copy.id = call.id;
    copy.trackId = track.id;
    copy.gain = -60;
    if (background) {
      copy.name = "Background fill · " + source.name;
      delete copy.parentId;
      copy.parentOffset = [1, 0, 0, 1, 0, 0];
      copy.matte = undefined;
      copy.mask = null;
      copy.masks = [];
      copy.crop = resolveClip(source, source.start).crop;
      const fit = Math.min(
        p.settings.width / asset.width,
        p.settings.height / asset.height,
      );
      // Overscan the blurred source to keep the blur kernel away from canvas edges.
      const w = p.settings.width,
        h = p.settings.height;
      const left = Math.max(
        (w - asset.width * fit) / 2,
        copy.crop.cropLeft * w,
      );
      const top = Math.max((h - asset.height * fit) / 2, copy.crop.cropTop * h);
      const right = Math.min(
        (w + asset.width * fit) / 2,
        (1 - copy.crop.cropRight) * w,
      );
      const bottom = Math.min(
        (h + asset.height * fit) / 2,
        (1 - copy.crop.cropBottom) * h,
      );
      if (right <= left || bottom <= top)
        throw Error("Background fill has no visible source aperture");
      const scale = Math.min(
        10,
        1.08 * Math.max(w / (right - left), h / (bottom - top)),
      );
      copy.transform = {
        ...copy.transform,
        x: (w / 2 - (left + right) / 2) * scale,
        y: (h / 2 - (top + bottom) / 2) * scale,
        scale,
        rotation: 0,
      };
      for (const key of ["x", "y", "scale", "rotation"] as const)
        copy.keyframes[key] = [];
      copy.effectStack.push({
        id: call.id + "-blur",
        type: "blur",
        enabled: true,
        value: call.blur,
        keys: [],
      });
    } else {
      copy.name = "Foreground person · " + source.name;
      copy.masks.push(call.mask);
      if (call.silhouette) {
        copy.kind = "shape";
        delete copy.assetId;
        copy.name = "Subject flash · " + source.name;
        copy.shape = {type:"rectangle", color:call.silhouette.color, width:p.settings.width, height:p.settings.height};
        copy.effectStack = [];
        copy.effects = {brightness:1,contrast:1,saturation:1,blur:0};
        delete copy.timeRemap;
        const values=new Map([[0,0]]);
        let end=0;
        for(const span of call.silhouette.spans){
          if(span.start<end || span.end<=span.start || span.end>source.duration) throw Error("Subject flash lies outside its raw shot");
          values.set(span.start,1);
          if(span.end<source.duration)values.set(span.end,0);
          end=span.end;
        }
        copy.transform.opacity=values.get(0)!;
        copy.keyframes.opacity=[...values].map(([frame,value])=>({frame,value,easing:"hold"}));
      }
    }
    p.clips.push(copy);
  };
}
