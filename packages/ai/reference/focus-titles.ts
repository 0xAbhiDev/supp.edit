import {consensusGlyph} from "./title-consensus";
import type { TextAppearance } from "./appearance";
import { matchReferenceFonts } from "./font-match";
import { titleRuns, type InkFrame } from "./title-surface";
import type { Transcript } from "../transcript";

const middle=(a:number[])=>a.sort((x,y)=>x-y)[a.length>>1]??0;
const overlap=(a:number,b:number,c:number,d:number)=>Math.max(0,Math.min(b,d)-Math.max(a,c));

/** Compare changing glyph pixels to an exposed plate at the same coordinates on adjacent frames. */
export function plateFit(run:ReturnType<typeof titleRuns>[number], frames:InkFrame[]) {
  const pairs:{fg:number[];bg:number[]}[]=[];
  const first=run.frames[Math.floor(run.frames.length/2)];
  const neighbors=frames.filter(f=>f.ink && (f.timeMs<run.startMs || f.timeMs>=run.endMs) && Math.abs(f.timeMs-first.timeMs)<850)
    .sort((a,b)=>Math.abs(a.timeMs-first.timeMs)-Math.abs(b.timeMs-first.timeMs));
  for(let j=0;j<first.samples.length;j+=4){
    if(!first.samples[j])continue;
    const uncovered=neighbors.find(f=>!f.samples[j]);
    if(!uncovered)continue;
    pairs.push({fg:Array.from(first.samples.slice(j+1,j+4)),bg:Array.from(uncovered.samples.slice(j+1,j+4))});
  }
  const fill=[0,1,2].map(c=>middle(pairs.map(p=>p.fg[c])));
  const sum=[0,1,2].map(c=>middle(pairs.map(p=>p.fg[c]+p.bg[c])));
  const error=(difference:boolean)=>middle(pairs.map(p=>p.fg.reduce((s,v,c)=>s+Math.abs(v-(difference?Math.abs(Math.min(255,sum[c])-p.bg[c]):fill[c])),0)/3));
  return {pairs:pairs.length, solid:error(false), difference:error(true), ink:"#"+sum.map(v=>Math.min(255,v).toString(16).padStart(2,"0")).join("")};
}

/** Earlier chroma-band reading, kept for lettering the negative-ink model does not isolate. */
export async function chromaTitles(frames:InkFrame[], endMs:number, seeds:TextAppearance[], aspect:number, transcript?:Transcript, reviews:{timeMs:number;content:string}[]=[]){
  const runs=titleRuns(frames,endMs), result:TextAppearance[]=[];
  const words=(transcript?.segments??[]).flatMap(s=>s.words??[]);
  for(const run of runs){
    if(run.frames.length<3)continue;
    const seed=seeds.filter(s=>s.content && s.role!=="persistent-overlay" && s.evidence?.status!=="uncertain")
      .sort((a,b)=>overlap(b.startMs,b.endMs,run.startMs,run.endMs)-overlap(a.startMs,a.endMs,run.startMs,run.endMs))[0];
    const confirmed=seed && overlap(seed.startMs,seed.endMs,run.startMs,run.endMs)>(run.endMs-run.startMs)*.5 ? seed:undefined;
    const measured=run.frames.map(f=>f.ink!);
    const box={x:middle(measured.map(f=>f.x)),y:middle(measured.map(f=>f.y)),width:middle(measured.map(f=>f.width)),height:middle(measured.map(f=>f.height))};
    const representative=measured.slice().sort((a,b)=>Math.abs(a.width-box.width)+Math.abs(a.height-box.height)-Math.abs(b.width-box.width)-Math.abs(b.height-box.height))[0];
    const fit=plateFit(run,frames);
    const review=reviews.find(q=>q.timeMs>=run.startMs && q.timeMs<run.endMs);
    const candidates=review?[review.content]:confirmed?[confirmed.content!]:[...new Set(words.filter(w=>w.startMs<run.endMs+200 && w.endMs>run.startMs-200)
      .flatMap(w=>{const s=w.text.replace(/[^\p{L}\p{N}'’]/gu,"");return s?[s.toUpperCase(),s[0].toUpperCase()+s.slice(1).toLowerCase()]:[];}))];
    const consensus=consensusGlyph(run.frames,frames);
    const input=candidates.flatMap(content=>[...(consensus?[consensus]:[]),{...box,glyphRows:representative.rows}].map(shape=>({...shape,content,startMs:run.startMs,endMs:run.endMs,words:1,foreground:representative.fill})));
    const matched=(await matchReferenceFonts(input,aspect)).sort((a,b)=>(b.face?.fit??0)-(a.face?.fit??0));
    const best=matched[0];
    console.debug("reference glyph fit",run.startMs,JSON.stringify(matched.map(m=>[m.content,m.face?.family,Number((m.face?.fit??0).toFixed(3))])));
    const spoken=words.find(w=>w.text.replace(/[^\p{L}\p{N}]/gu,"").toLowerCase()===best?.content?.toLowerCase() && (w.confidence??0)>.9 && overlap(w.startMs,w.endMs,run.startMs,run.endMs)>(run.endMs-run.startMs)*.45);
    if(!best || (!review && !confirmed && (best.face?.fit??0)<(spoken ? .49 : .57)))continue;
    const runner=matched.find(m=>m.content?.toLowerCase()!==best.content?.toLowerCase());
    if(!review && !confirmed && runner && (best.face?.fit??0)-(runner.face?.fit??0)<.06)continue;
    // A script swash may disappear in a compression-damaged frame. Require consistent geometry
    // before committing motion keys, retaining real movement across multiple observations.
    const geometry=run.frames.filter((_,i)=>i===0 || i%2===0).map(({ink,timeMs})=>({timeMs,x:ink!.x,y:ink!.y,width:ink!.width,height:ink!.height}))
      .filter(g=>Math.abs(g.x-box.x)<.035 && Math.abs(g.width-box.width)<box.width*.12 && Math.abs(g.height-box.height)<box.height*.12)
      .slice(0,128);
    const localEvidence=measured.filter(m=>m.pairs>=35 && m.inverseError+3<m.solidError).length;
    // A flat subject flash is an observable background color under the glyph.
    // Test the same registered ink pixels immediately before and during the flash.
    const unlit=run.frames.find(f=>!f.flash);
    const reversed=unlit && run.frames.some(f=>{
      if(!f.flash)return false;
      const color=[1,3,5].map(i=>parseInt(f.flash!.slice(i,i+2),16));
      let changed=0, explained=0;
      for(let j=0;j<f.samples.length;j+=4){
        if(!f.samples[j] || !unlit.samples[j])continue;
        const delta=color.reduce((s,_,c)=>s+Math.abs(f.samples[j+1+c]-unlit.samples[j+1+c]),0)/3;
        if(delta<45)continue;
        changed++;
        if(color.reduce((s,v,c)=>s+Math.abs(255-v-f.samples[j+1+c]),0)/3<20)explained++;
      }
      return changed>=12 && explained/changed>.65;
    });
    const inverse=reversed || (fit.pairs>=20 && fit.difference+2<fit.solid && fit.difference<24) || localEvidence>=measured.length*.55;
    result.push({...best,...(!best.face && confirmed?.face ? {face:confirmed.face,inkMetrics:confirmed.inkMetrics}:{}),...box,geometry,observations:run.frames.length,
      ...(inverse?{differenceInk:reversed?'#ffffff':fit.pairs>=20?fit.ink:representative.inverse}:{}),
      evidence:review?{status:"reviewed",kind:"title",wordStartsMs:[],beatDistanceMs:null}:confirmed?.evidence??{status:"audio-visual",kind:"captioned-speech",wordStartsMs:[],beatDistanceMs:null}});
  }
  return result;
}

