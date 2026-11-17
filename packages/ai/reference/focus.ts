import type {Asset} from "../../project-schema";
import type {JobContext} from "../../jobs";
import type {StyleDNA} from "./dna";
import type {PersonSample} from "./subject-mask";
import type {Transcript} from "../transcript";
import {sourceUrl} from "../../platform";
import {seekMedia} from "../../engine/seek-media";
import {inspectTitleFrame,titleBand,type InkFrame} from "./title-surface";
import {chromaTitles} from "./focus-titles";
import {negativeInk} from "./title-ink";
import {inkTitles,COLOR_STRIDE,type InkFrame as InkSampleFrame} from "./ink-titles";
import {frameTone,medianTone,type Tone} from "./tone";
import {restrictReference,type ReferenceInterval} from "./interval";

export { restrictReference, type ReferenceInterval } from "./interval";

export async function traceTitles(asset:Asset,dna:StyleDNA,range:ReferenceInterval,people:PersonSample[],transcript:Transcript|undefined,job:Pick<JobContext,"checkpoint">,url?:string,reviewText=""){
  const focused=restrictReference(dna,range), seeds=focused.text??[];
  const seed=seeds.filter(t=>t.role!=="persistent-overlay" && t.evidence?.status!=="uncertain" && t.content).sort((a,b)=>b.width-a.width)[0];
  if(!seed) return {dna:focused,warnings:["No confirmed title band in the selected interval."]};
  const video=document.createElement("video"), canvas=document.createElement("canvas");
  video.muted=true;video.preload="auto";video.crossOrigin="anonymous";
  const scale=Math.min(1,640/Math.max(asset.width,asset.height)),w=canvas.width=Math.max(1,Math.round(asset.width*scale)),h=canvas.height=Math.max(1,Math.round(asset.height*scale));
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  if(!ctx)throw Error("Decoded title analysis needs a readable canvas.");
  const frames:InkFrame[]=[];
  // Full-resolution negative-ink evidence beside the earlier chroma measurements.
  const band=titleBand(seed,w,h), inks:InkSampleFrame[]=[], tones:{shot:number;tone:Tone}[]=[];
  const overlays=seeds.filter(t=>t.role==="persistent-overlay").map(t=>({x:Math.floor((t.x-t.width*.15)*w)-band.x,y:Math.floor((t.y-t.height*.3)*h)-band.y,right:Math.ceil((t.x+t.width*1.15)*w)-band.x,bottom:Math.ceil((t.y+t.height*1.3)*h)-band.y}));
  const cw=Math.ceil(band.width/COLOR_STRIDE), ch=Math.ceil(band.height/COLOR_STRIDE);
  const rate=Math.min(60,asset.fps||30);
  try{
    const src=url??await sourceUrl(asset);
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>finish(new Error("Loading the local reference timed out.")),20000);
      const finish=(err?:Error)=>{clearTimeout(timer);video.onloadeddata=video.onerror=null;err?reject(err):resolve();};
      video.onloadeddata=()=>finish();video.onerror=()=>finish(new Error("Could not decode the local reference."));video.src=src;
    });
    const visible=people.filter(p=>p.points.length);
    for(let i=Math.ceil(range.startMs*rate/1000);i<Math.round(range.endMs*rate/1000);i++){
      await job.checkpoint();
      const time=i/rate,timeMs=Math.round(time*1000);
      if(time>=video.duration)break;
      const target=Math.min(video.duration-.00001,time+.2/rate);
      // A frame already on screen presents nothing new; step away first so the wait observes real pixels.
      if(Math.abs(video.currentTime-target)<.5/rate) await seekMedia(video,Math.min(video.duration-.00001,target+2/rate),asset.fps||30);
      await seekMedia(video,target,asset.fps||30).catch(e=>{throw Error(`Reference frame ${i} at ${time}s: ${e}`);});
      ctx.drawImage(video,0,0,w,h);
      const mask=visible.reduce<PersonSample|undefined>((a,b)=>!a||Math.abs(b.timeMs-timeMs)<Math.abs(a.timeMs-timeMs)?b:a,undefined);
      const data=ctx.getImageData(0,0,w,h).data, inspected=inspectTitleFrame(data,w,h,4,seed,timeMs,mask);
      frames.push(inspected);
      const ink=negativeInk(data,w,h,4,band);
      // A recurring handle or logo is not part of the title.
      for(const o of overlays)for(let y=Math.max(0,o.y);y<Math.min(band.height,o.bottom);y++)ink.fill(0,y*band.width+Math.max(0,Math.min(band.width,o.x)),y*band.width+Math.max(0,Math.min(band.width,o.right)));
      const colors=new Uint8Array(cw*ch*3);
      for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
        const from=((band.y+y*COLOR_STRIDE)*w+band.x+x*COLOR_STRIDE)*4, to=(y*cw+x)*3;
        colors[to]=data[from];colors[to+1]=data[from+1];colors[to+2]=data[from+2];
      }
      const shot=focused.shots.findIndex(q=>timeMs>=q.startMs&&timeMs<q.endMs);
      inks.push({timeMs,mask:ink,colors,shot,flash:!!inspected.flash,pulsed:focused.colorPulses.some(q=>timeMs>=q.startMs&&timeMs<q.endMs)});
      if(!inspected.flash)tones.push({shot,tone:frameTone(data,w,h,4,band)});
    }
  }finally{video.removeAttribute("src");video.load();}
  focused.shots.forEach((shot,index)=>{
    // The median frame is unaffected by a brief full-frame pulse.
    const tone=medianTone(tones.filter(t=>t.shot===index).map(t=>t.tone));
    if(tone)shot.tone=tone;
  });
  for(const shot of focused.shots){
    const plates=frames.filter(f=>f.timeMs>=shot.startMs&&f.timeMs<shot.endMs&&!f.flash).map(f=>f.plate);
    if(plates.length<3)continue;
    const mid=[0,1,2].map(c=>plates.map(p=>p[c]).sort((a,b)=>a-b)[plates.length>>1]);
    const peak=Math.max(...mid), floor=Math.min(...mid);
    if(peak-floor>=8)shot.plateTint="#"+mid.map(c=>Math.round(c*175/Math.max(1,peak)).toString(16).padStart(2,"0")).join("");
  }
  const reviews=reviewText.split(/\r?\n/).filter(s=>s.trim()).map(s=>{
    const m=/^\s*(\d+(?:\.\d+)?)\s+(.{1,120}?)\s*$/.exec(s);
    if(!m)throw Error("Enter a time in seconds and the visible word on each review line.");
    const timeMs=Math.round(Number(m[1])*1000);
    if(timeMs<range.startMs || timeMs>=range.endMs)throw Error("Reviewed word lies outside the selected interval.");
    return {timeMs,content:m[2]};
  });
  const cy=(seed.y+seed.height/2)*h-band.y;
  const read=await inkTitles({samples:inks,band,frame:{w,h},endMs:range.endMs,centerY:cy,reach:seed.height*h*.43,seeds,transcript,reviews});
  let measured=read.titles;
  // Lettering the negative model cannot isolate (a flat colored fill) keeps the chroma-band reading.
  const chroma=(await chromaTitles(frames,range.endMs,seeds,w/h,transcript,reviews)).filter(c=>!measured.some(m=>Math.min(m.endMs,c.endMs)-Math.max(m.startMs,c.startMs)>(c.endMs-c.startMs)*.3));
  measured=[...measured,...chroma];
  const top=band.y/h, bottom=(band.y+band.height)/h;
  // A re-measured interval replaces the coarse observation of the same pixels, whatever it read.
  const preserved=seeds.filter(s=>!measured.some(m=>Math.min(m.endMs,s.endMs)-Math.max(m.startMs,s.startMs)>(s.endMs-s.startMs)*.3 && s.role!=="persistent-overlay" && s.y+s.height/2>top && s.y+s.height/2<bottom && Math.abs(s.x+s.width/2-(m.x+m.width/2))<Math.max(s.width,m.width)));
  const flashes:NonNullable<StyleDNA["personFlashes"]>=[];
  for(let i=0;i<frames.length;i++){
    const f=frames[i];if(!f.flash)continue;
    const end=frames[i+1]?.timeMs??range.endMs,last=flashes.at(-1);
    if(last && last.endMs===f.timeMs && [1,3,5].every(c=>Math.abs(parseInt(last.color.slice(c,c+2),16)-parseInt(f.flash!.slice(c,c+2),16))<=5))last.endMs=end;
    else flashes.push({startMs:f.timeMs,endMs:end,color:f.flash});
  }
  return {dna:{...focused,text:[...preserved,...measured].sort((a,b)=>a.startMs-b.startMs),personFlashes:flashes},warnings:[...(measured.length?[]:["Dense title analysis could not corroborate additional lettering."]),
    // Name the moments rather than guess the words; the reviewer can supply them.
    ...(read.unread.filter(u=>!measured.some(m=>m.startMs<u.endMs&&m.endMs>u.startMs)).length?["Lettering at "+read.unread.filter(u=>!measured.some(m=>m.startMs<u.endMs&&m.endMs>u.startMs)).map(u=>(u.startMs/1000).toFixed(2)+"–"+(u.endMs/1000).toFixed(2)+" s").join(", ")+" was isolated but not read with enough evidence. Enter it under visually reviewed words to include it."]:[])]};
}

