import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { launchBrowser } from "./runtime.mjs";
const positional=process.argv.slice(2).filter(a=>!a.startsWith("--"));
const option=name=>process.argv.find(a=>a.startsWith("--"+name+"="))?.slice(name.length+3);
// --mode=Smart Adaptation|Creative Remix, --format=vertical, --exclude=assetId,assetId (raw clips withheld),
// --audio=music|reference|recreate (recreate here plans without generated effects; the app generates them)
const mode=option("mode")??"Close Match", format=option("format")??"reference", excluded=new Set((option("exclude")??"").split(",").filter(Boolean)), audioMode=option("audio")??"music";
const [inventory,profile,out,start,end]=positional;
if(!end)throw Error("Supply the asset inventory, existing DNA JSON, new output directory, and reference in/out milliseconds.");
const read=p=>JSON.parse(fs.readFileSync(p,"utf8").replace(/^\uFEFF/,""));
const optional=name=>fs.existsSync(path.join(inventory,name))?read(path.join(inventory,name)):undefined;
const project=optional("SOURCE.supp"),ref=project.assets[0];
const review=positional[5]?fs.readFileSync(positional[5],"utf8").trim():"";
fs.mkdirSync(out,{recursive:true});
const host=await createServer({server:{host:"127.0.0.1",port:0,hmr:false,watch:null}});
let browser;
try{
  await host.listen();browser=await launchBrowser(chromium);
  const page=await browser.newPage();
  page.on("console",m=>{if(/^reference (glyph fit|title)/.test(m.text()))console.log(m.text());});
  const site=host.resolvedUrls.local[0], url=new URL("verification-reference.mp4",site).href;
  await page.route(url,r=>r.fulfill({path:ref.path,contentType:"video/mp4"}));
  const origin=new URL("verification.html",site).href;
  await page.route(origin,r=>r.fulfill({contentType:"text/html",body:"<!doctype html><title>Reference verification</title>"}));
  await page.goto(origin);
  const range={startMs:Number(start),endMs:Number(end)};
  const traced=await page.evaluate(async ([ref,dna,range,people,transcript,url,review])=>{
    const blob=URL.createObjectURL(await (await fetch(url)).blob());
    try{return await (await import("/packages/ai/reference/focus.ts")).traceTitles(ref,dna,range,people,transcript,{checkpoint:async()=>{}},blob,review);}finally{URL.revokeObjectURL(blob);}
  },[ref,read(profile),range,optional("0-person.json")??[],optional("0-speech.json")?.transcript,url,review]);
  // Tone of each raw source, decoded by the same routine the application uses.
  const tones={};
  for(const [i,asset] of project.assets.entries()){
    if(!i||asset.kind!=="video")continue;
    const media=new URL("verification-source-"+i,site).href;
    await page.route(media,r=>r.fulfill({path:asset.path.replace(/^\\\\\?\\/,""),contentType:asset.name.endsWith(".webm")?"video/webm":"video/mp4"}));
    tones[asset.id]=await page.evaluate(async ([asset,media])=>{
      const blob=URL.createObjectURL(await (await fetch(media)).blob());
      try{return await (await import("/packages/ai/reference/source-tone.ts")).sourceTone(asset,{checkpoint:async()=>{}},blob);}finally{URL.revokeObjectURL(blob);}
    },[asset,media]);
  }
  // The soundtracks, decoded and measured by the application's own routine on the shared clock.
  const measureAudio=async(asset,file,type,words)=>{
    const media=new URL(file,site).href;
    await page.route(media,r=>r.fulfill({path:asset.path.replace(/^\\\\\?\\/,""),contentType:type}));
    return page.evaluate(async ([asset,media,words])=>{
      const blob=URL.createObjectURL(await (await fetch(media)).blob());
      try{return await (await import("/packages/ai/audio/service.ts")).audioTimeline(asset,words,blob);}finally{URL.revokeObjectURL(blob);}
    },[asset,media,words]);
  };
  const words=(optional("0-speech.json")?.transcript?.segments??[]).flatMap(s=>s.words??[]).map(w=>({text:w.text,startMs:w.startMs,endMs:w.endMs,confidence:w.confidence}));
  const referenceAudio=ref.hasAudio?await measureAudio(ref,"verification-reference-audio.mp4","video/mp4",words):undefined;
  const {dnaSchema}=await host.ssrLoadModule("/packages/ai/reference/dna.ts");
  const {buildEventGraph}=await host.ssrLoadModule("/packages/ai/reference/event-graph.ts");
  let dna=dnaSchema.parse(traced.dna);
  if(referenceAudio)dna=dnaSchema.parse({...dna,audio:referenceAudio,eventGraph:buildEventGraph(dna,referenceAudio,1000/(ref.fps||30))});
  const {buildRecreation,defaults}=await host.ssrLoadModule("/packages/ai/reference/planner.ts");
  const {History}=await host.ssrLoadModule("/packages/commands/index.ts");
  const {applyEditPreview}=await host.ssrLoadModule("/packages/ai/editor-agent/execution.ts");
  const {parseProject}=await host.ssrLoadModule("/packages/project-schema/index.ts");
  const p=parseProject(project),sources=p.assets.flatMap((asset,i)=>i && asset.kind==="video" && !excluded.has(asset.id)?[{asset,analysis:optional(i+"-vision.json"),color:optional("colors.json").find(c=>c.assetId===asset.id),visual:optional(i+"-visual.json"),people:optional(i+"-person.json"),aperture:optional(i+"-aperture.json"),tone:tones[asset.id]}]:[]);
  const music=p.assets.find(a=>a.kind==="audio"),history=new History(p);
  // Reference mode: the soundtrack extracted to its own audio asset by the application's routine.
  const soundtrack=audioMode==="reference"&&ref.hasAudio?await page.evaluate(async ([asset,media])=>{
    const blob=URL.createObjectURL(await (await fetch(media)).blob());
    try{return await (await import("/packages/ai/audio/service.ts")).soundtrackAsset(asset,blob);}finally{URL.revokeObjectURL(blob);}
  },[ref,new URL("verification-reference-audio.mp4",site).href]):undefined;
  const musicAudio=audioMode==="recreate"&&music?await measureAudio(music,"verification-music","audio/"+(music.name.split(".").pop()==="mp3"?"mpeg":music.name.split(".").pop()),[]):undefined;
  const edit=buildRecreation(p,history.currentVersion,ref,dna,sources,{...defaults,interval:range,mode,format,wording:"original",audio:audioMode},music,music&&optional(p.assets.indexOf(music)+"-audio.json")?.audio?.beatMap,undefined,undefined,{reference:dna.audio,music:musicAudio,soundtrack});
  const applied=history.execute(p,"Reconstruct reference interval",applyEditPreview(edit.preview,p,history.currentVersion));
  assert.deepEqual(history.undo(applied).compositions,p.compositions);assert.deepEqual(history.redo(p).compositions,applied.compositions);
  const json=JSON.stringify(applied),saved=parseProject(JSON.parse(json));
  assert.deepEqual(JSON.parse(JSON.stringify(saved.compositions)),JSON.parse(JSON.stringify(applied.compositions)));
  const c=saved.compositions.at(-1);
  // Source isolation: pictures come only from the raw pool; the reference video never appears; its
  // extracted soundtrack may appear on an audio track, and only when that mode was asked for.
  const audioTracks=new Set(c.tracks.filter(t=>t.kind==="audio").map(t=>t.id));
  assert(c.layers.every(l=>l.assetId!==ref.id));
  assert(c.layers.every(l=>!l.assetId||[...sources.map(s=>s.asset.id),music?.id].includes(l.assetId)||(soundtrack&&l.assetId===soundtrack.id&&audioTracks.has(l.trackId))));
  const ai=c.ai??{};
  const write=(file,s)=>fs.writeFileSync(path.join(out,file),s,{flag:"wx"});
  write("Focused.supp",json);write("dna.json",JSON.stringify(dna,null,2));
  const report={interval:range,composition:c.name,settings:c.settings,duration:c.duration,historyRoundTrip:true,sourceIsolation:true,matches:edit.matches,warnings:[...traced.warnings,...edit.warnings],titles:c.layers.filter(l=>l.kind==="text").map(l=>({content:l.text.content,font:l.text.font,weight:l.text.weight,size:l.text.size,start:l.start,end:l.start+l.duration,blend:l.blendMode,color:l.text.color})),
    grade:c.layers.filter(l=>l.kind==="shape"&&/Measured/.test(l.name)).map(l=>({name:l.name,color:l.shape.color,blend:l.blendMode,opacity:l.transform.opacity,matte:l.matte?.mode})),
    tone:dna.shots.map(q=>q.tone),flashes:dna.personFlashes,
    audio:{mode:ai.audioMode,notes:ai.audioNotes,referenceEvents:(ai.referenceEvents??[]).length,linkedLayers:(ai.referenceEvents??[]).reduce((n,e)=>n+e.links.length,0),
      tracks:c.tracks.filter(t=>t.kind==="audio").map(t=>({name:t.name,clips:c.layers.filter(l=>l.trackId===t.id).map(l=>({asset:p.assets.find(a=>a.id===l.assetId)?.name,start:l.start,sourceIn:l.sourceIn,duration:l.duration,gain:l.gain}))})),
      measured:dna.audio&&{beats:dna.audio.beats.length,tempo:dna.audio.tempo.slice(0,8),events:Object.fromEntries([...new Set(dna.audio.events.map(e=>e.kind))].map(k=>[k,dna.audio.events.filter(e=>e.kind===k).length]))},
      grammar:dna.eventGraph?.grammar}};
  write("verification-plan.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser?.close();await host.close();}

