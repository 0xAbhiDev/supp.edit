import {execFileSync} from "node:child_process";
import {mediaEnvironment} from "./runtime.mjs";
const [reference,previous,current,destination,...times]=process.argv.slice(2);
if(!times.length)throw Error("Supply three MP4s, output image and frame indices at 30 fps.");
const env=mediaEnvironment(), w=320,h=240;
const rows=[];
for(const t of times.map(Number)){
  const args=["-v","error","-nostdin"];
  for(const movie of [reference,previous,current])args.push("-i",movie);
  const filters=["Reference","Previous","Focused Windows export"].map((label,i)=>
    `[${i}:v]fps=30,select='eq(n,${t})',scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h+24}:(ow-iw)/2:24+(oh-24-ih)/2:color=0x171717,drawtext=font=Arial:text='${label}   f${t}':fontsize=14:fontcolor=white:x=8:y=3[v${i}]`);
  args.push("-filter_complex",filters.join(";")+";[v0][v1][v2]hstack=3","-frames:v","1","-f","rawvideo","-pix_fmt","rgb24","pipe:1");
  const row=execFileSync(env.SUPP_FFMPEG,args,{env,windowsHide:true,maxBuffer:3*w*(h+24)*3+4096});
  if(row.length!==3*w*(h+24)*3)throw Error("Missing comparison frame "+t);
  rows.push(row);
}
execFileSync(env.SUPP_FFMPEG,["-v","error","-n","-f","rawvideo","-pix_fmt","rgb24","-s",3*w+"x"+(h+24)*rows.length,"-i","pipe:0","-frames:v","1",destination],{input:Buffer.concat(rows),env,windowsHide:true});

