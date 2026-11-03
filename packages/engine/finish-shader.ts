/** Counterpart of finishPixels; preserve alpha and avoid RGB halos at transparent edges. */
export const finishShader = `
uniform int u_finishKind;
uniform vec4 u_finish;
float grainNoise(uvec2 p,uint seed){
  uint h=p.x*73856093u^p.y*19349663u^seed*83492791u;
  h=(h^(h>>16u))*0x7feb352du;h=(h^(h>>15u))*0x846ca68bu;
  return float(h^(h>>16u))/4294967295.0-.5;
}
vec3 finishColor(vec3 rgb,vec4 pixel){
  float value=u_finish.x;
  if(u_finishKind==1){
    vec2 point=v_uv*u_output/max(.25,u_finish.y),cell=floor(point),t=fract(point);t=t*t*(3.0-2.0*t);
    uvec2 p=uvec2(cell);uint seed=uint(u_finish.w);
    float a=grainNoise(p,seed),b=grainNoise(p+uvec2(1,0),seed),c=grainNoise(p+uvec2(0,1),seed),d=grainNoise(p+uvec2(1,1),seed);
    return rgb+mix(a,mix(mix(a,b,t.x),mix(c,d,t.x),t.y),u_finish.z)*value;
  }
  if(u_finishKind==2)return rgb*(1.0-value*smoothstep(.25,1.0,length(v_uv*2.0-1.0)/sqrt(2.0)));
  if(u_finishKind==4)return rgb*vec3(1.0+.08*value,1.0,1.0-.08*value);
  if(u_finishKind==5)return rgb+(value-1.0)*(rgb-.5)*4.0*rgb*(1.0-rgb);
  vec3 sum=vec3(0),lo=rgb,hi=rgb;float weight=0.0;
  for(int i=0;i<4;i++){
    vec2 offset=i==0?vec2(-1,0):i==1?vec2(1,0):i==2?vec2(0,-1):vec2(0,1);
    vec4 n=sampleFrame(v_uv+offset/u_output);
    if(n.a>.000001){vec3 c=n.rgb/n.a;sum+=c*n.a;weight+=n.a;lo=min(lo,c);hi=max(hi,c);}
  }
  return weight>0.0?clamp(rgb+clamp((rgb-sum/weight)*value,-.025,.025),lo,hi):rgb;
}`;
