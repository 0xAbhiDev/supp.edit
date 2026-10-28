/** Premultiplied blend functions; indices follow compositing/model.ts.
 * Formula reference: https://www.w3.org/TR/compositing-1/#blending
 */
export const blendShader = `
float lum(vec3 c){return dot(c,vec3(.3,.59,.11));}
float sat(vec3 c){return max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b));}
vec3 clipColor(vec3 c){
  float l=lum(c),n=min(c.r,min(c.g,c.b)),x=max(c.r,max(c.g,c.b));
  if(n<0.0)c=l+(c-l)*l/max(0.000001,l-n);
  if(x>1.0)c=l+(c-l)*(1.0-l)/max(0.000001,x-l);
  return c;
}
vec3 setLum(vec3 c,float l){return clipColor(c+vec3(l-lum(c)));}
vec3 setSat(vec3 c,float s){
  float n=min(c.r,min(c.g,c.b)),x=max(c.r,max(c.g,c.b));
  return x>n?(c-vec3(n))*s/(x-n):vec3(0);
}
float blendChannel(float b,float s,int mode){
  if(mode==1)return b*s;
  if(mode==2)return b+s-b*s;
  if(mode==3)return b<=.5?2.0*b*s:1.0-2.0*(1.0-b)*(1.0-s);
  if(mode==4)return min(b,s);
  if(mode==5)return max(b,s);
  if(mode==6)return b<=0.0?0.0:s>=1.0?1.0:min(1.0,b/(1.0-s));
  if(mode==7)return b>=1.0?1.0:s<=0.0?0.0:1.0-min(1.0,(1.0-b)/s);
  if(mode==8)return s<=.5?2.0*b*s:1.0-2.0*(1.0-b)*(1.0-s);
  if(mode==9){float d=b<=.25?((16.0*b-12.0)*b+4.0)*b:sqrt(b);return s<=.5?b-(1.0-2.0*s)*b*(1.0-b):b+(2.0*s-1.0)*(d-b);}
  if(mode==10)return abs(b-s);
  if(mode==11)return b+s-2.0*b*s;
  return s;
}
vec4 blendPixel(vec4 backdrop,vec4 source,int mode) {
  if(mode==16)return min(vec4(1),backdrop+source);
  vec3 b=backdrop.a>0.000001?backdrop.rgb/backdrop.a:vec3(0);
  vec3 s=source.a>0.000001?source.rgb/source.a:vec3(0);
  vec3 mixed;
  if(mode==12)mixed=setLum(setSat(s,sat(b)),lum(b));
  else if(mode==13)mixed=setLum(setSat(b,sat(s)),lum(b));
  else if(mode==14)mixed=setLum(s,lum(b));
  else if(mode==15)mixed=setLum(b,lum(s));
  else mixed=vec3(blendChannel(b.r,s.r,mode),blendChannel(b.g,s.g,mode),blendChannel(b.b,s.b,mode));
  float alpha=source.a+backdrop.a*(1.0-source.a);
  vec3 rgb=(1.0-source.a)*backdrop.rgb+(1.0-backdrop.a)*source.rgb+source.a*backdrop.a*mixed;
  return vec4(clamp(rgb,0.0,1.0),alpha);
}
`;
