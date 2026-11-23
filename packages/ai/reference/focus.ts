import type {Asset} from "../../project-schema";
import type {JobContext} from "../../jobs";
import type {StyleDNA} from "./dna";
import type {PersonSample} from "./subject-mask";
import type {Transcript} from "../transcript";
import {sourceUrl} from "../../platform";
import {seekMedia} from "../../engine/seek-media";
import {inspectTitleFrame,titleBand,type InkFrame} from "./title-surface";
import {chromaTitles} from "./focus-titles";
import {negativeInk,distinctInk,plateColors,personCover} from "./title-ink";
import {inkTitles,COLOR_STRIDE,type InkFrame as InkSampleFrame} from "./ink-titles";
import {frameTone,medianTone,type Tone} from "./tone";
import {annotateSubjects} from "./subject-shape";
import {restrictReference,type ReferenceInterval} from "./interval";
import {pieceOf} from "./title-read";

export { restrictReference, type ReferenceInterval } from "./interval";

export async function traceTitles(asset:Asset,dna:StyleDNA,range:ReferenceInterval,people:PersonSample[],transcript:Transcript|undefined,job:Pick<JobContext,"checkpoint">,url?:string,reviewText=""){
  const focused=restrictReference(dna,range), seeds=focused.text??[];
  // Only the band's position comes from OCR here, not its words: an uncertain observation of
  // lettering may anchor it when nothing in the interval was read with confidence.
  const lettering=seeds.filter(t=>t.role!=="persistent-overlay" && t.content);
  const seed=[...lettering.filter(t=>t.evidence?.status!=="uncertain"),...lettering].sort((a,b)=>Number(a.evidence?.status==="uncertain")-Number(b.evidence?.status==="uncertain")||b.width-a.width)[0];
  if(!seed) return {dna:focused,warnings:["No confirmed title band in the selected interval."]};
  const video=document.createElement("video"), canvas=document.createElement("canvas");
  video.muted=true;video.preload="auto";video.crossOrigin="anonymous";
  const scale=Math.min(1,640/Math.max(asset.width,asset.height)),w=canvas.width=Math.max(1,Math.round(asset.width*scale)),h=canvas.height=Math.max(1,Math.round(asset.height*scale));
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  if(!ctx)throw Error("Decoded title analysis needs a readable canvas.");
  const frames:InkFrame[]=[];
  // Full-resolution negative-ink evidence beside the earlier chroma measurements.
  // Titles share a center line but not a width: a long word can span the whole frame.
  const tall=titleBand(seed,w,h), band={x:Math.floor(w*.01),y:tall.y,width:w-2*Math.floor(w*.01),height:tall.height};
  const inks:InkSampleFrame[]=[], tones:{shot:number;tone:Tone}[]=[];
  const overlays=seeds.filter(t=>t.role==="persistent-overlay").map(t=>({x:Math.floor((t.x-t.width*.15)*w)-band.x,y:Math.floor((t.y-t.height*.3)*h)-band.y,right:Math.ceil((t.x+t.width*1.15)*w)-band.x,bottom:Math.ceil((t.y+t.height*1.3)*h)-band.y}));
  const cw=Math.ceil(band.width/COLOR_STRIDE), ch=Math.ceil(band.height/COLOR_STRIDE);
  const label=new Uint8Array(band.width*band.height);
  for(const o of overlays)for(let y=Math.max(0,o.y);y<Math.min(band.height,o.bottom);y++)label.fill(1,y*band.width+Math.max(0,Math.min(band.width,o.x)),y*band.width+Math.max(0,Math.min(band.width,o.right)));
  // Band pixels inside a person contour, widened slightly: the measured outline is low resolution.
  const coverOf=(p:PersonSample|undefined,timeMs:number)=>!p?.points.length||Math.abs(p.timeMs-timeMs)>100?undefined:personCover(p.points,band,w,h,Math.max(2,Math.round(w*.008)));
  // Every sampled frame keeps two band masks (white and colored lettering) for the whole interval.
  // A 75 s reference at its full 30 fps held about 300 MB of them, the reading added more, and the
  // web view died near 1 GB. Above INK_BUDGET the sampling rate drops to fit, never below 12 a
  // second (a title held a third of a second is still seen four times).
  const INK_BUDGET=160*1024*1024;
  const fits=INK_BUDGET/Math.max(1,(range.endMs-range.startMs)/1000*2*band.width*band.height);
  const rate=Math.min(60,asset.fps||30,Math.max(12,Math.floor(fits)));
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
      // White lettering composited in difference mode, or a flat colored fill.
      const plate=plateColors(data,w,h,4,band), ink=negativeInk(data,w,h,4,band,plate);
      // A flat subject flash is itself a concentrated color; only negative ink is read over it.
      const flat=inspected.flash?undefined:distinctInk(data,w,h,4,band,plate);
      for(let k=0;k<ink.length;k++)if(label[k]){ink[k]=0;if(flat)flat[k]=0;}
      const colors=new Uint8Array(cw*ch*3);
      for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
        const from=((band.y+y*COLOR_STRIDE)*w+band.x+x*COLOR_STRIDE)*4, to=(y*cw+x)*3;
        colors[to]=data[from];colors[to+1]=data[from+1];colors[to+2]=data[from+2];
      }
      const shot=focused.shots.findIndex(q=>timeMs>=q.startMs&&timeMs<q.endMs);
      const person=coverOf(mask,timeMs);
      inks.push({timeMs,mask:ink,flat:flat??new Uint8Array(ink.length),colors,shot,flash:!!inspected.flash,pulsed:focused.colorPulses.some(q=>timeMs>=q.startMs&&timeMs<q.endMs),label,...(person?{person}:{})});
      if(!inspected.flash)tones.push({shot,tone:frameTone(data,w,h,4,band)});
    }
  }finally{video.removeAttribute("src");video.load();}
  annotateSubjects(focused,people,asset.width/Math.max(1,asset.height));
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
  // White and difference lettering, then flat colored lettering, each from its own evidence.
  // Moving skin or clothing can look like a concentrated color; mixing the two would let it
  // damage the white words. The first pass wins where both read something at the same time.
  const common={band,frame:{w,h},endMs:range.endMs,centerY:cy,reach:seed.height*h*.43,seeds,transcript,reviews};
  const white=await inkTitles({...common,samples:inks});
  const colored=await inkTitles({...common,samples:inks.map(f=>({...f,mask:f.flat!}))});
  const during=(a:{startMs:number;endMs:number},b:{startMs:number;endMs:number})=>Math.min(a.endMs,b.endMs)-Math.max(a.startMs,b.startMs)>(b.endMs-b.startMs)*.3;
  const titles=[...white.titles,...colored.titles.filter(t=>!white.titles.some(q=>during(q,t)))];
  const read={titles,unread:[...white.unread,...colored.unread].filter(u=>!titles.some(t=>during(t,u))),notes:[...white.notes,...colored.notes]};
  let measured=read.titles;
  // Lettering the negative model cannot isolate (a flat colored fill) keeps the chroma-band reading.
  const chroma=(await chromaTitles(frames,range.endMs,seeds,w/h,transcript,reviews)).filter(c=>!measured.some(m=>Math.min(m.endMs,c.endMs)-Math.max(m.startMs,c.startMs)>(c.endMs-c.startMs)*.3));
  measured=[...measured,...chroma];
  // Two independent measurements of the same lettering must agree before the dense trace
  // replaces the text reading: about the same size and the same ink lightness. A trace that
  // swells to several times the read line height or inverts its ink has segmented something else
  // (a subject or the scene under the title) and is set aside; the reading is kept.
  const disagreements:string[]=[];
  measured=measured.filter(m=>{
    // Two measurements of the same lettering share its place: the same line and the same columns.
    // A reading beside the trace (a corner handle at the line's height) is other lettering.
    const under=seeds.filter(s=>s.content && s.role!=="persistent-overlay" && Math.min(m.endMs,s.endMs)-Math.max(m.startMs,s.startMs)>0 && Math.abs(s.y+s.height/2-(m.y+m.height/2))<Math.max(s.height,m.height) && Math.min(s.x+s.width,m.x+m.width)-Math.max(s.x,m.x)>0.3*Math.min(s.width,m.width));
    if(!under.length)return true;
    const ratio=m.height/Math.max(1e-3,[...under.map(s=>s.height)].sort((a,b)=>a-b)[under.length>>1]);
    const ink=(hex?:string)=>hex&&/^#[0-9a-f]{6}$/i.test(hex)?(0.2126*parseInt(hex.slice(1,3),16)+0.7152*parseInt(hex.slice(3,5),16)+0.0722*parseInt(hex.slice(5,7),16))/255:undefined;
    const a=ink(m.foreground),b=ink(under[0].foreground);
    const inverted=a!==undefined&&b!==undefined&&Math.abs(a-b)>0.35;
    // Uncertain OCR pieces of the very word the trace read do not contradict its ink: the trace
    // was assembled from them, and a piece read off a blurred frame measures ink poorly. A
    // confident reading, or any size disagreement, still sets the trace aside.
    const agreeing=!!m.content&&under.every(s=>s.evidence?.status==="uncertain"&&s.content!.split(/\s+/).every(piece=>pieceOf(piece,m.content!)));
    console.debug("dense title check",m.startMs,m.content,ratio.toFixed(2),a?.toFixed(2),b?.toFixed(2),agreeing,JSON.stringify(under.map(s=>[s.content,s.evidence?.status??null,s.foreground??null,+s.x.toFixed(2),+s.width.toFixed(2)])),+m.x.toFixed(2),+m.width.toFixed(2));
    if(ratio<=2&&ratio>=0.5&&(!inverted||agreeing))return true;
    disagreements.push(`Dense title analysis at ${(m.startMs/1000).toFixed(2)} s disagreed with the text reading (${ratio>2||ratio<0.5?`${ratio.toFixed(1)}× its size`:"inverted ink"}); the reading "${under.map(s=>s.content).join(" ")}" was kept.`);
    return false;
  });
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
  return {dna:{...focused,text:[...preserved,...measured].sort((a,b)=>a.startMs-b.startMs),personFlashes:flashes},warnings:[...(measured.length?[]:["Dense title analysis could not corroborate additional lettering."]),...disagreements,...read.notes,
    // Name the moments rather than guess the words; the reviewer can supply them.
    ...read.unread.filter(u=>!measured.some(m=>m.startMs<u.endMs&&m.endMs>u.startMs)).map(u=>"Lettering at "+(u.startMs/1000).toFixed(2)+"–"+(u.endMs/1000).toFixed(2)+" s was isolated but not read with enough evidence"+(u.hints.length?" ("+u.hints.join("; ")+")":"")+". Enter it under visually reviewed words to include it.")]};
}

