import type {StyleDNA} from "./dna";

export interface ReferenceInterval {startMs:number;endMs:number}
export function restrictReference(dna:StyleDNA, range:ReferenceInterval):StyleDNA{
  const {startMs,endMs}=range;
  if(!Number.isFinite(startMs)||!Number.isFinite(endMs)||startMs<0||endMs<=startMs||endMs-startMs>600000)throw Error("Choose a reference interval of up to ten minutes.");
  const shots=dna.shots.filter(s=>s.startMs<endMs&&s.endMs>startMs).map(s=>({...s,startMs:Math.max(s.startMs,startMs),endMs:Math.min(s.endMs,endMs)}));
  if(!shots.length)throw Error("The interval is outside the reference video.");
  return {...dna,shots,transitions:dna.transitions.filter(t=>t.cutMs>startMs&&t.cutMs<endMs),colorPulses:dna.colorPulses.filter(t=>t.startMs>=startMs&&t.endMs<=endMs),
    text:dna.text?.filter(s=>s.startMs<endMs&&s.endMs>startMs).map(s=>({...s,startMs:Math.max(startMs,s.startMs),endMs:Math.min(endMs,s.endMs)}))??null};
}
