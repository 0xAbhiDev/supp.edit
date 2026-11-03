import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import assert from "node:assert/strict";
import { mediaEnvironment } from "./runtime.mjs";
const env = mediaEnvironment(), dir = "test-results/audio-mix/";
const json = (name) => JSON.parse(readFileSync(dir + name, "utf8"));
const saved = json("NATIVE_AUDIO.supp"), before = json("native-before-close.supp"), original = json("EDITABLE.supp");
assert.deepEqual(saved.compositions, before.compositions);
assert.deepEqual(saved.transcripts, before.transcripts);
assert.deepEqual(saved.compositions[0].layers, original.compositions[0].layers);
const music = saved.compositions[0].layers.find(c => c.name === "music.wav");
assert.equal(music.keyframes.gain.find(k => k.frame === 90).value, -17.25);
const run = args => execFileSync(env.SUPP_FFMPEG, ["-v", "error", ...args], {env, windowsHide:true, maxBuffer:100*1024*1024});
const file = dir + "render.mp4";
const meta = JSON.parse(execFileSync(env.SUPP_FFPROBE,["-v","error","-show_streams","-show_format","-of","json",file],{env,windowsHide:true,encoding:"utf8"}));
const video = meta.streams.find(s=>s.codec_type==="video"), audio=meta.streams.find(s=>s.codec_type==="audio");
assert.equal(video.codec_name,"h264"); assert.equal(audio.codec_name,"aac"); assert.equal(Number(video.nb_frames),300);
assert.equal(Number(meta.format.duration),10);
run(["-xerror","-i",file,"-f","null","-"]);
const decode = name => run(["-i",dir+name,"-vn","-ac","2","-ar","48000","-f","f32le","pipe:1"]);
const actual=decode("render.mp4"), expected=decode("speech-and-music.mp4");
// The reference was independently compared to timeline source samples and gain
// envelopes in verify-audio-mix. Byte equality proves this UI export retains it.
assert.deepEqual(actual,expected,"Native UI audio differs from independently verified timeline export");
let peak=0,sum=0;
for(let i=0;i<actual.length;i+=4){const x=actual.readFloatLE(i);peak=Math.max(peak,Math.abs(x));sum+=x*x;}
assert.ok(sum>0&&peak<1);
const pixels=run(["-i",file,"-an","-vf","scale=32:18","-pix_fmt","rgb24","-f","rawvideo","pipe:1"]);
let black=0; const frameSize=32*18*3;
for(let start=0;start<pixels.length;start+=frameSize) if(!pixels.subarray(start,start+frameSize).some(v=>v>5))black++;
assert.equal(black,0);
copyFileSync(file,dir+"NATIVE_AUDIO.mp4");
const result={file:"NATIVE_AUDIO.mp4",frames:300,duration:10,video:video.codec_name,audio:audio.codec_name,blackFrames:black,decodedAudioMatchesVerifiedTimelineExactly:true,unintendedOffsetSamples:0,channelPeak:peak,rms:Math.sqrt(sum/(actual.length/4)),manualGain:{frame:90,value:-17.25},musicGainKeys:music.keyframes.gain.length,captions:saved.compositions[0].layers.filter(c=>c.kind==="text").length,transcripts:saved.transcripts.length,nativeCloseReopenExact:true};
writeFileSync(dir+"native-verification.json",JSON.stringify(result,null,2)); console.log(JSON.stringify(result,null,2));
