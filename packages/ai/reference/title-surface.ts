import type { TextAppearance } from "./appearance";
import type { PersonSample } from "./subject-mask";

type Box = Pick<TextAppearance, "x" | "y" | "width" | "height">;
export type InkFrame = ReturnType<typeof inspectTitleFrame>;
const median = (v: number[]) => v.sort((a,b) => a-b)[v.length >> 1] ?? 0;
const hex = (v: number[]) => "#" + v.map(c => Math.min(255, Math.max(0, Math.round(c))).toString(16).padStart(2, "0")).join("");
function inside(x: number, y: number, points: PersonSample["points"]) {
  let value = false;
  for (let i=0,j=points.length-1; i<points.length; j=i++) {
    const a=points[i], b=points[j];
    if ((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) value=!value;
  }
  return value;
}

/** Pixel rectangle searched for one title: wider than the seed for longer words, and tall
 * enough for script ascenders, descenders and swashes. */
export function titleBand(seed: Box, w: number, h: number) {
  const cx=seed.x+seed.width/2, cy=seed.y+seed.height/2;
  const x=Math.max(0,Math.floor((cx-Math.max(seed.width*.67,.17))*w)), x1=Math.min(w,Math.ceil((cx+Math.max(seed.width*.67,.17))*w));
  const y=Math.max(0,Math.floor((cy-seed.height*1.5)*h)), y1=Math.min(h,Math.ceil((cy+seed.height*1.5)*h));
  return {x,y,width:x1-x,height:y1-y};
}

/** Measure a short, user-selected title band. Only geometry, color and evidence scores leave this function. */
export function inspectTitleFrame(data: Uint8Array | Uint8ClampedArray, w: number, h: number, channels: 3 | 4, seed: Box, timeMs: number, person?: PersonSample) {
  const sums = [0,0,0];
  for (let i=0; i<w*h; i+=37) for (let c=0;c<3;c++) sums[c]+=data[i*channels+c];
  const rank=[0,1,2].sort((a,b)=>sums[b]-sums[a]);
  const cx=seed.x+seed.width/2, cy=seed.y+seed.height/2;
  const x0=Math.max(0,Math.floor((cx-Math.max(seed.width*.67,.17))*w)), x1=Math.min(w,Math.ceil((cx+Math.max(seed.width*.67,.17))*w));
  const y0=Math.max(0,Math.floor((cy-seed.height*1.5)*h)), y1=Math.min(h,Math.ceil((cy+seed.height*1.5)*h));
  const pixels=new Uint8Array(w*h);
  const counterCast=(i:number)=>data[i+rank[1]]-data[i+rank[0]]>2 && data[i+rank[2]]>=data[i+rank[0]];
  let flash: string | undefined;
  if (person?.points.length && Math.abs(person.timeMs-timeMs)<=100) {
    const bins=new Map<number, number[]>(); let total=0;
    for(let y=2;y<h;y+=5) for(let x=2;x<w;x+=5) {
      if(!inside(x/w,y/h,person.points)) continue;
      const i=(y*w+x)*channels, r=data[i],g=data[i+1],b=data[i+2];
      const key=((r>>4)<<8)|((g>>4)<<4)|(b>>4), bin=bins.get(key)??[0,0,0,0];
      bin[0]++;bin[1]+=r;bin[2]+=g;bin[3]+=b; bins.set(key,bin);total++;
    }
    const top=[...bins.values()].sort((a,b)=>b[0]-a[0])[0];
    if(top && total>=25 && top[0]/total>.42) {
      const rgb=top.slice(1).map(v=>v/top[0]);
      // Reject black clothes, white walls and neutral specular highlights.
      if(Math.min(...rgb)>65 && Math.max(...rgb)-Math.min(...rgb)>18) flash=hex(rgb);
    }
  }
  const nSamples=Math.ceil(w*h/37);
  const plate=sums.map(c=>Math.round(c/nSamples));
  const band={x:x0,y:y0,columns:Math.ceil((x1-x0)/3),w,h};
  const none={timeMs,flash,plate,band,ink:undefined, samples:new Uint8Array()};
  if(sums[rank[0]]-sums[rank[1]] < Math.ceil(w*h/37)*4) return none;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++) {
    const i=y*w+x;
    if(counterCast(i*channels)) pixels[i]=1;
  }
  // Remove isolated codec speckles and off-baseline scene details. Keep connected script strokes.
  const queue=new Int32Array((x1-x0)*(y1-y0)), marked=new Uint8Array(w*h);
  const kept:number[]=[];
  for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) {
    const start=y*w+x;
    if(!pixels[start]||marked[start])continue;
    let n=1,lo=y,hi=y;queue[0]=start;marked[start]=1;
    for(let j=0;j<n;j++){
      const at=queue[j],py=Math.floor(at/w);lo=Math.min(lo,py);hi=Math.max(hi,py);
      for(const k of [at-1,at+1,at-w,at+w])if(k>=0 && k<pixels.length && Math.abs(k%w-at%w)<=1 && pixels[k]&&!marked[k]){marked[k]=1;queue[n++]=k;}
    }
    if(n<Math.max(6,w*h*.00010) || hi-lo<seed.height*h*.18 || lo>(cy+.43*seed.height)*h || hi<(cy-.43*seed.height)*h)continue;
    for(let j=0;j<n;j++)kept.push(queue[j]);
  }
  if(kept.length<Math.max(20,w*h*.001))return none;
  let left=w,right=0,top=h,bottom=0;
  for(const p of kept){const x=p%w,y=Math.floor(p/w);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  const width=right-left+1,height=bottom-top+1, counts=new Uint16Array(512);
  const fg:number[][]=[],bg:number[][]=[];
  for(const p of kept){
    const x=p%w,y=Math.floor(p/w);
    counts[Math.min(15,Math.floor((y-top)*16/height))*32+Math.min(31,Math.floor((x-left)*32/width))]++;
    if(p%3)continue;
    // Estimate the covered plate on both sides of the nearest glyph edge.
    let best=Infinity, adjacent:number[]=[];
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      for(let d=1;d<=Math.min(18,height*.45);d++){
        const px=x+dx*d,py=y+dy*d;
        if(px<1||py<1||px>=w-1||py>=h-1)break;
        const k=py*w+px;
        if(pixels[k])continue;
        if(d<best){best=d;adjacent=[];}
        if(d===best){ const ahead=3; const bx=Math.max(0,Math.min(w-1,px+dx*ahead)), by=Math.max(0,Math.min(h-1,py+dy*ahead)); adjacent.push((by*w+bx)*channels); }
        break;
      }
    }
    if(best<2||!adjacent.length)continue;
    fg.push([0,1,2].map(c=>data[p*channels+c]));
    bg.push([0,1,2].map(c=>median(adjacent.map(i=>data[i+c]))));
  }
  const rows=Array.from({length:16},(_,y)=>{
    let bits=0;
    for(let x=0;x<32;x++) if(counts[y*32+x]>=Math.max(1,width*height/512*.33))bits|=1<<x;
    return bits>>>0;
  });
  const fill=[0,1,2].map(c=>median(fg.map(p=>p[c])));
  const inverse=[0,1,2].map(c=>median(fg.map((p,i)=>p[c]+bg[i][c])));
  const residual=(predict:(i:number,c:number)=>number)=>fg.reduce((t,p,i)=>t+Math.min(100,p.reduce((s,v,c)=>s+Math.abs(v-predict(i,c)),0)/3),0)/Math.max(1,fg.length);
  const solidError=residual((_,c)=>fill[c]), inverseError=residual((i,c)=>Math.abs(Math.min(255,inverse[c])-bg[i][c]));
  const samples=new Uint8Array(Math.ceil((y1-y0)/3)*Math.ceil((x1-x0)/3)*4); let n=0;
  for(let y=y0;y<y1;y+=3) for(let x=x0;x<x1;x+=3){
    const p=y*w+x,i=p*channels;
    samples[n++]=pixels[p]; samples[n++]=data[i];samples[n++]=data[i+1];samples[n++]=data[i+2];
  }
  return { timeMs, flash, plate,band, samples, ink:{x:left/w,y:top/h,width:width/w,height:height/h,rows,fill:hex(fill),inverse:hex(inverse),pairs:fg.length,solidError,inverseError} };
}

export function titleRuns(frames:InkFrame[], endMs:number) {
  const runs:{frames:InkFrame[];startMs:number;endMs:number}[]=[];
  for(let i=0;i<frames.length;i++){
    const f=frames[i], prior=frames[i-1], last=runs.at(-1);
    if(!f.ink)continue;
    let both=0,all=0;
    for(let j=0;j<f.samples.length;j+=4){
      const a=f.samples[j], b=prior?.samples[j]??0;
      both+=a&b;all+=a|b;
    }
    const same=both/Math.max(1,all)>.56;
    if(last && same){ last.frames.push(f);last.endMs=frames[i+1]?.timeMs??endMs; }
    else runs.push({frames:[f],startMs:f.timeMs,endMs:frames[i+1]?.timeMs??endMs});
  }
  return runs;
}

