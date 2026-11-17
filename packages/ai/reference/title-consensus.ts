import type { InkFrame } from "./title-surface";

/** Recover stationary strokes across changing scenery. A high-coverage chroma mask is combined
 * with the observed negative of pixels uncovered by other words at the same screen location. */
export function consensusGlyph(run:InkFrame[],frames:InkFrame[]){
  const key=run[run.length>>1], {columns,w,h,x:ox,y:oy}=key.band;
  const count=key.samples.length/4, rows=Math.ceil(count/columns);
  if(!key.ink||!count)return;
  const outside=frames.filter(f=>f.samples.length===key.samples.length && !run.includes(f) && Math.abs(f.timeMs-key.timeMs)<900)
    .sort((a,b)=>Math.abs(a.timeMs-key.timeMs)-Math.abs(b.timeMs-key.timeMs));
  const flags=new Uint8Array(count);
  for(let i=0;i<count;i++){
    const j=i*4, exposed=outside.find(f=>!f.samples[j]);
    let votes=0;
    for(const f of run){
      if(f.samples[j]){votes++;continue;}
      if(!exposed)continue;
      let residual=0,change=0;
      for(let c=1;c<=3;c++){
        residual+=Math.abs(f.samples[j+c]+exposed.samples[j+c]-255);
        change+=Math.abs(f.samples[j+c]-exposed.samples[j+c]);
      }
      if(residual/3<19 && change/3>60)votes++;
    }
    if(votes>=Math.ceil(run.length*.52))flags[i]=1;
  }
  // Estimate the word from stroke groups touching the measured baseline; detached
  // flourishes are kept when they touch another stroke at the sampled resolution.
  const visited=new Uint8Array(count),queue=new Int32Array(count);
  const groups:{pts:number[],x:number,y:number,endX:number,endY:number}[]=[];
  const cy=((key.ink.y+key.ink.height/2)*h-oy)/3;
  for(let i=0;i<count;i++){
    if(visited[i]||!flags[i])continue;
    let n=1;queue[0]=i;visited[i]=1;
    let x=columns,endX=0,y=rows,endY=0;
    for(let k=0;k<n;k++){
      const j=queue[k],px=j%columns,py=Math.floor(j/columns);
      x=Math.min(x,px);endX=Math.max(endX,px);y=Math.min(y,py);endY=Math.max(endY,py);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const next=j+dy*columns+dx;
        if(next>=0&&next<count&&px+dx>=0&&px+dx<columns&&flags[next]&&!visited[next]){visited[next]=1;queue[n++]=next;}
      }
    }
    if(n>=3 && y<cy+4 && endY>cy-4)groups.push({pts:Array.from(queue.slice(0,n)),x,y,endX,endY});
  }
  const cx=((key.ink.x+key.ink.width/2)*w-ox)/3,half=key.ink.width*w/6;
  const kept=groups.filter(g=>g.endX>=cx-half-2 && g.x<=cx+half+2);
  if(!kept.length)return;
  const left=Math.min(...kept.map(g=>g.x)),top=Math.min(...kept.map(g=>g.y)),bw=Math.max(...kept.map(g=>g.endX))-left+1,bh=Math.max(...kept.map(g=>g.endY))-top+1;
  const shape=new Uint8Array(count);
  for(const g of kept)for(const i of g.pts)shape[i]=1;
  const glyphRows=Array.from({length:16},(_,y)=>{
    let bits=0;for(let x=0;x<32;x++){
      let hits=0;
      for(const px of [.25,.75])for(const py of [.25,.75])hits+=shape[(top+Math.floor((y+py)*bh/16))*columns+left+Math.floor((x+px)*bw/32)];
      if(hits>=2)bits|=1<<x;
    }
    return bits>>>0;
  });
  return {x:(ox+left*3-1)/w,y:(oy+top*3-1)/h,width:bw*3/w,height:bh*3/h,glyphRows};
}

