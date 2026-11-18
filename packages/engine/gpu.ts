import {textSurface} from "./text-surface";
import type { Clip, Project } from "../project-schema";
import { resolveClip } from "../animation";
import {
  canvasMatrix,
  identity,
  inverse,
  localMatrix,
  matrix3,
  multiply,
  type Affine,
} from "../animation/affine";
import { LruCache } from "./lru";
import { blendModes, matteModes } from "../compositing/model";
import { grainOf, curvesOf } from "../effects/model";
import { curveUniforms } from "../effects/curves";
import { blendShader } from "./blend-shader";
import { resolvedEffects } from "../effects/evaluate";
import { finishShader } from "./finish-shader";
import { isFinishEffect } from "./finish-effects";

const vertex = `#version 300 es
in vec2 a_position;
uniform vec2 u_output;
uniform vec4 u_rect;
uniform mat3 u_matrix;
out vec2 v_uv;
void main(){
  v_uv=a_position;
  vec2 position=(u_matrix*vec3(u_rect.xy+a_position*u_rect.zw,1.0)).xy;
  gl_Position=vec4(position.x/u_output.x*2.0-1.0,1.0-position.y/u_output.y*2.0,0,1);
}`;
const fragment = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_image;
uniform sampler2D u_bezierMask;
uniform bool u_hasBezierMask;
uniform sampler2D u_matte;
uniform sampler2D u_backdrop;
uniform int u_matteMode;
uniform int u_blendMode;
uniform int u_pass;
uniform vec2 u_output;
uniform vec2 u_direction;
uniform float u_sigma;
uniform vec4 u_color;
uniform mat3 u_inverse;
uniform vec4 u_mask;
uniform vec4 u_crop;
uniform int u_maskType;
uniform float u_opacity;
uniform vec2 u_project;
in vec2 v_uv;
out vec4 result;
${blendShader}
vec4 sampleFrame(vec2 uv){if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec4(0);return texture(u_image,vec2(uv.x,1.0-uv.y));}
${finishShader}
void main(){
  if(u_pass==0){result=texture(u_image,v_uv);return;}
  vec4 pixel;
  if(u_pass==1){
    vec4 sum=vec4(0);float total=0.0;
    float stepSize=max(1.0,ceil(u_sigma*3.0/12.0));
    for(int i=-12;i<=12;i++){float distance=float(i)*stepSize;float weight=exp(-0.5*distance*distance/max(0.01,u_sigma*u_sigma));sum+=sampleFrame(v_uv+u_direction*distance)*weight;total+=weight;}
    result=sum/total;return;
  }
  pixel=sampleFrame(v_uv);
  vec3 rgb=pixel.a>0.000001?pixel.rgb/pixel.a:vec3(0);
  if(u_pass==5){result=vec4(clamp(finishColor(rgb,pixel),0.0,1.0)*pixel.a,pixel.a);return;}
  rgb*=u_color.x;
  rgb=(rgb-0.5)*u_color.y+0.5;
  float luminance=dot(rgb,vec3(0.2126,0.7152,0.0722));
  rgb=mix(vec3(luminance),rgb,u_color.z);
  if(u_pass==3){result=vec4(clamp(rgb,0.0,1.0)*pixel.a,pixel.a);return;}
  float mask=1.0;
  if(u_pass!=4){
    vec2 local=(u_inverse*vec3(v_uv*u_project,1.0)).xy;
    vec2 uv=local/u_project+0.5;
    if(u_hasBezierMask) mask*=float(all(greaterThanEqual(uv,vec2(0)))&&all(lessThanEqual(uv,vec2(1))))*texture(u_bezierMask,clamp(uv,0.0,1.0)).a;
    mask*=float(all(greaterThanEqual(uv,u_crop.xy))&&all(lessThanEqual(uv,vec2(1)-u_crop.zw)));
    if(u_maskType>0){
    vec2 normalized=(local-u_mask.xy)/u_mask.zw;
    if(u_maskType==1) mask*=float(all(greaterThanEqual(normalized,vec2(0)))&&all(lessThanEqual(normalized,vec2(1))));
    else {float d=length(normalized*2.0-1.0);float edge=max(fwidth(d),0.0001);mask*=1.0-smoothstep(1.0-edge,1.0+edge,d);}
  }
  }
  if(u_matteMode>0){
    vec4 m=texture(u_matte,v_uv);
    float coverage=u_matteMode<=2?m.a:dot(m.rgb,vec3(.2126,.7152,.0722));
    if(u_matteMode==2||u_matteMode==4)coverage=1.0-coverage;
    mask*=coverage;
  }
  float alpha=pixel.a*u_opacity*mask;
  result=vec4(clamp(rgb,0.0,1.0)*alpha,alpha);
  if(u_blendMode>0)result=blendPixel(texture(u_backdrop,vec2(v_uv.x,1.0-v_uv.y)),result,u_blendMode);
}`;
type Texture = {
  texture: WebGLTexture;
  width: number;
  height: number;
  stamp?: number;
  input?: TexImageSource;
};
type Generated = {
  canvas: HTMLCanvasElement;
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Real texture compositing. Browser video surfaces upload directly; pixels are never read on the CPU during preview. */
export class GpuRenderer {
  readonly canvas = document.createElement("canvas");
  readonly gl: WebGL2RenderingContext;
  readonly device: string;
  private program: WebGLProgram;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private vao: WebGLVertexArrayObject;
  private buffer: WebGLBuffer;
  private fbo: WebGLFramebuffer;
  private targets: Texture[] = [];
  private maskTexture?: Texture;
  private matteTexture?: Texture;
  private backdrop?: Texture;
  private textures: LruCache<string, Texture>;
  private generators = new LruCache<string, Generated>(32 * 1024 * 1024, 24);
  private width = 0;
  private height = 0;
  private lost = false;
  constructor() {
    const gl = this.canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: true,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 is unavailable");
    this.gl = gl;
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    this.device = String(
      gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
    );
    this.canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.lost = true;
    });
    const shaders = [
      this.shader(gl.VERTEX_SHADER, vertex),
      this.shader(gl.FRAGMENT_SHADER, fragment),
    ];
    const program = gl.createProgram();
    if (!program) throw new Error("GPU program allocation failed");
    shaders.forEach((shader) => gl.attachShader(program, shader));
    gl.linkProgram(program);
    shaders.forEach((shader) => gl.deleteShader(shader));
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(
        gl.getProgramInfoLog(program) || "GPU shader link failed",
      );
    this.program = program;
    gl.useProgram(program);
    this.vao = gl.createVertexArray()!;
    this.buffer = gl.createBuffer()!;
    this.fbo = gl.createFramebuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const location = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    this.textures = new LruCache(128 * 1024 * 1024, 48, (t) =>
      gl.deleteTexture(t.texture),
    );
  }
  private shader(type: number, source: string) {
    const gl = this.gl,
      shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(message || "GPU shader compile failed");
    }
    return shader;
  }
  private uniform(name: string) {
    if (!this.uniforms.has(name))
      this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name)!;
  }
  private texture(width: number, height: number): Texture {
    const gl = this.gl,
      texture = gl.createTexture();
    if (!texture) throw new Error("GPU texture allocation failed");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    return { texture, width, height };
  }
  get bytes() {
    return (
      this.textures.bytes +
      (this.matteTexture
        ? this.matteTexture.width * this.matteTexture.height * 4
        : 0) +
      (this.backdrop ? this.backdrop.width * this.backdrop.height * 4 : 0) +
      (this.maskTexture
        ? this.maskTexture.width * this.maskTexture.height * 4
        : 0) +
      this.targets.reduce((n, t) => n + t.width * t.height * 4, 0)
    );
  }
  begin(width: number, height: number, background = "#000000") {
    const gl = this.gl;
    if (this.lost || gl.isContextLost())
      throw new Error("GPU context lost; CPU fallback active");
    if (
      width > gl.getParameter(gl.MAX_TEXTURE_SIZE) ||
      height > gl.getParameter(gl.MAX_TEXTURE_SIZE) ||
      width * height * 8 > 256 * 1024 * 1024
    )
      throw new Error("Frame exceeds GPU surface budget; CPU fallback active");
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.canvas.width = width;
      this.canvas.height = height;
      this.targets.forEach((t) => gl.deleteTexture(t.texture));
      this.targets = [this.texture(width, height), this.texture(width, height)];
    }
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, width, height);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.uniform("u_image"), 0);
    gl.uniform2f(this.uniform("u_output"), width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.BLEND);
    const color =
      background === "transparent"
        ? [0, 0, 0, 0]
        : [
            parseInt(background.slice(1, 3), 16) / 255,
            parseInt(background.slice(3, 5), 16) / 255,
            parseInt(background.slice(5, 7), 16) / 255,
            1,
          ];
    gl.clearColor(color[0], color[1], color[2], color[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  private target(texture: Texture | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, texture ? this.fbo : null);
    if (texture) {
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture.texture,
        0,
      );
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error("GPU framebuffer incomplete");
    }
  }
  private full() {
    const gl = this.gl;
    gl.uniform4f(this.uniform("u_rect"), 0, 0, this.width, this.height);
    gl.uniformMatrix3fv(this.uniform("u_matrix"), false, matrix3(identity()));
  }
  private generated(p: Project, c: Clip): Generated {
    const key = JSON.stringify([
      c.kind,
      c.kind === "text" ? c.text : c.shape,
      this.width / p.settings.width,
    ]);
    const cached = this.generators.get(key);
    if (cached) return cached;
    if(c.kind==="text"){
      const value=textSurface(c.text,this.width/p.settings.width);
      this.generators.set(key,value,value.canvas.width*value.canvas.height*4);
      return value;
    }
    const canvas = document.createElement("canvas"),
      ctx = canvas.getContext("2d")!;
    let width = c.shape.width,
      height = c.shape.height,
      left = -width / 2,
      top = -height / 2;
    const scale = Math.min(
      1,
      4096 / width,
      4096 / height,
      this.width / p.settings.width,
    );
    canvas.width = Math.max(1, Math.ceil(width * scale));
    canvas.height = Math.max(1, Math.ceil(height * scale));
    ctx.scale(scale, scale);
    ctx.translate(-left, -top);
    {
      ctx.fillStyle = c.shape.color;
      ctx.beginPath();
      if (c.shape.type === "ellipse")
        ctx.ellipse(0, 0, width / 2, height / 2, 0, 0, Math.PI * 2);
      else ctx.rect(left, top, width, height);
      ctx.fill();
    }
    const value = { canvas, left, top, width, height };
    this.generators.set(key, value, canvas.width * canvas.height * 4);
    return value;
  }
  draw(
    p: Project,
    c: Clip,
    frame: number,
    source?: CanvasImageSource,
    world?: Affine,
    coverage?: HTMLCanvasElement,
    matteSource?: HTMLCanvasElement,
  ) {
    const matrix = canvasMatrix(p, world ?? localMatrix(c, frame));
    const stack = resolvedEffects(c, frame);
    c = resolveClip(c, frame);
    const gl = this.gl,
      t = c.transform,
      scale = this.width / p.settings.width;
    let left: number,
      top: number,
      width: number,
      height: number,
      key: string,
      input: TexImageSource;
    if (c.kind === "text" || c.kind === "shape") {
      const g = this.generated(p, c);
      ({ left, top, width, height } = g);
      input = g.canvas;
      key = JSON.stringify([
        c.kind,
        c.kind === "text" ? c.text : c.shape,
        g.canvas.width,
        g.canvas.height,
      ]);
    } else {
      if (!source) return;
      const a =
        c.kind === "composition"
          ? p.compositions.find((a) => a.id === c.compositionId)?.settings
          : p.assets.find((a) => a.id === c.assetId);
      if (!a || ("kind" in a && a.kind === "audio")) return;
      const fit = Math.min(
        p.settings.width / a.width,
        p.settings.height / a.height,
      );
      width = a.width * fit;
      height = a.height * fit;
      left = -width / 2;
      top = -height / 2;
      input = source as TexImageSource;
      key = c.id + ":" + ("fingerprint" in a ? a.fingerprint : c.compositionId);
    }
    const dimensions = input as HTMLVideoElement &
      HTMLImageElement &
      HTMLCanvasElement;
    const w =
        dimensions.videoWidth || dimensions.naturalWidth || dimensions.width,
      h =
        dimensions.videoHeight || dimensions.naturalHeight || dimensions.height;
    let texture = this.textures.get(key);
    if (texture && (texture.width !== w || texture.height !== h)) {
      this.textures.delete(key);
      texture = undefined;
    }
    if (!texture) {
      texture = this.texture(w, h);
      if (!this.textures.set(key, texture, w * h * 4))
        throw new Error("Source texture exceeds GPU cache budget");
    }
    gl.bindTexture(gl.TEXTURE_2D, texture.texture);
    const stamp =
      input instanceof HTMLVideoElement
        ? input.currentTime
        : input instanceof ImageBitmap || input instanceof HTMLCanvasElement
          ? frame
          : 0;
    if (
      c.kind === "composition" ||
      texture.stamp !== stamp ||
      texture.input !== input
    ) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        input,
      );
      texture.stamp = stamp;
      texture.input = input;
    }
    this.target(this.targets[0]);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1i(this.uniform("u_pass"), 0);
    gl.uniform4f(this.uniform("u_rect"), left, top, width, height);
    gl.uniformMatrix3fv(
      this.uniform("u_matrix"),
      false,
      matrix3(multiply([scale, 0, 0, scale, 0, 0], matrix)),
    );
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (c.effects.blur > 0) {
      this.full();
      gl.uniform1i(this.uniform("u_pass"), 1);
      gl.uniform1f(this.uniform("u_sigma"), c.effects.blur * scale);
      this.target(this.targets[1]);
      gl.bindTexture(gl.TEXTURE_2D, this.targets[0].texture);
      gl.uniform2f(this.uniform("u_direction"), 1 / this.width, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this.target(this.targets[0]);
      gl.bindTexture(gl.TEXTURE_2D, this.targets[1].texture);
      gl.uniform2f(this.uniform("u_direction"), 0, 1 / this.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    this.target(null);
    this.full();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindTexture(gl.TEXTURE_2D, this.targets[0].texture);
    gl.uniform1i(this.uniform("u_pass"), 2);
    gl.uniform4f(
      this.uniform("u_color"),
      c.effects.brightness,
      c.effects.contrast,
      c.effects.saturation,
      0,
    );
    gl.uniform1f(this.uniform("u_opacity"), t.opacity);
    gl.uniformMatrix3fv(
      this.uniform("u_inverse"),
      false,
      matrix3(inverse(matrix)),
    );
    gl.uniform4f(
      this.uniform("u_crop"),
      c.crop.cropLeft,
      c.crop.cropTop,
      c.crop.cropRight,
      c.crop.cropBottom,
    );
    gl.uniform2f(
      this.uniform("u_project"),
      p.settings.width,
      p.settings.height,
    );
    // This uniform is read by the fragment mask, so geometry uses the full-screen rect with a separate vertex transform reset below.
    gl.uniform1i(
      this.uniform("u_maskType"),
      c.mask ? (c.mask.type === "ellipse" ? 2 : 1) : 0,
    );
    if (c.mask)
      gl.uniform4f(
        this.uniform("u_mask"),
        (c.mask.x - 0.5) * p.settings.width,
        (c.mask.y - 0.5) * p.settings.height,
        c.mask.width * p.settings.width,
        c.mask.height * p.settings.height,
      );
    gl.uniform1i(this.uniform("u_hasBezierMask"), coverage ? 1 : 0);
    gl.uniform1i(this.uniform("u_bezierMask"), 1);
    if (coverage) {
      gl.activeTexture(gl.TEXTURE1);
      if (
        this.maskTexture &&
        (this.maskTexture.width !== coverage.width ||
          this.maskTexture.height !== coverage.height)
      ) {
        gl.deleteTexture(this.maskTexture.texture);
        this.maskTexture = undefined;
      }
      this.maskTexture ??= this.texture(coverage.width, coverage.height);
      gl.bindTexture(gl.TEXTURE_2D, this.maskTexture.texture);
      if (this.maskTexture.input !== coverage) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          coverage,
        );
        this.maskTexture.input = coverage;
      }
      gl.activeTexture(gl.TEXTURE0);
    }
    if (stack.length) {
      // First preserve legacy source corrections and apply layer masks, with no final opacity/matte.
      gl.disable(gl.BLEND);
      gl.uniform1f(this.uniform("u_opacity"), 1);
      gl.uniform1i(this.uniform("u_matteMode"), 0);
      gl.uniform1i(this.uniform("u_blendMode"), 0);
      this.target(this.targets[1]);
      gl.bindTexture(gl.TEXTURE_2D, this.targets[0].texture);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      let current = 1;
      for (const effect of stack) {
        if (effect.type === "blur") {
          if (effect.value === 0) continue;
          gl.uniform1i(this.uniform("u_pass"), 1);
          gl.uniform1f(this.uniform("u_sigma"), effect.value * scale);
          for (const direction of [
            [1 / this.width, 0],
            [0, 1 / this.height],
          ]) {
            const next = 1 - current;
            this.target(this.targets[next]);
            gl.bindTexture(gl.TEXTURE_2D, this.targets[current].texture);
            gl.uniform2f(
              this.uniform("u_direction"),
              direction[0],
              direction[1],
            );
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            current = next;
          }
        } else {
          const next = 1 - current;
          this.target(this.targets[next]);
          gl.bindTexture(gl.TEXTURE_2D, this.targets[current].texture);
          gl.uniform1i(
            this.uniform("u_pass"),
            isFinishEffect(effect.type) ? 5 : 3,
          );
          if (isFinishEffect(effect.type)) {
            gl.uniform1i(
              this.uniform("u_finishKind"),
              {
                grain: 1,
                vignette: 2,
                sharpen: 3,
                temperature: 4,
                tonalContrast: 5,
                curves: 6,
              }[effect.type],
            );
            const curves = curvesOf(effect);
            if (curves) {
              const { data, counts } = curveUniforms(curves);
              gl.uniform3fv(this.uniform("u_curve"), data);
              gl.uniform3i(this.uniform("u_curveCount"), counts[0], counts[1], counts[2]);
            }
            gl.uniform4f(
              this.uniform("u_finish"),
              effect.value,
              (grainOf(effect).size ?? 1.2) * scale,
              grainOf(effect).softness ?? 0.6,
              Math.floor(frame - c.start),
            );
          }
          gl.uniform4f(
            this.uniform("u_color"),
            effect.type === "brightness" ? effect.value : 1,
            effect.type === "contrast" ? effect.value : 1,
            effect.type === "saturation" ? effect.value : 1,
            0,
          );
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          current = next;
        }
      }
      this.target(null);
      gl.bindTexture(gl.TEXTURE_2D, this.targets[current].texture);
      gl.uniform1i(this.uniform("u_pass"), 4);
      gl.uniform4f(this.uniform("u_color"), 1, 1, 1, 0);
      gl.uniform1f(this.uniform("u_opacity"), t.opacity);
      gl.enable(gl.BLEND);
    }
    gl.uniform1i(
      this.uniform("u_matteMode"),
      c.matte ? matteModes.indexOf(c.matte.mode) + 1 : 0,
    );
    gl.uniform1i(this.uniform("u_matte"), 2);
    if (c.matte && matteSource) {
      gl.activeTexture(gl.TEXTURE2);
      if (
        this.matteTexture &&
        (this.matteTexture.width !== matteSource.width ||
          this.matteTexture.height !== matteSource.height)
      ) {
        gl.deleteTexture(this.matteTexture.texture);
        this.matteTexture = undefined;
      }
      this.matteTexture ??= this.texture(matteSource.width, matteSource.height);
      gl.bindTexture(gl.TEXTURE_2D, this.matteTexture.texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        matteSource,
      );
      gl.activeTexture(gl.TEXTURE0);
    }
    const blend = blendModes.indexOf(c.blendMode);
    gl.uniform1i(this.uniform("u_blendMode"), blend);
    gl.uniform1i(this.uniform("u_backdrop"), 3);
    if (blend > 0) {
      gl.activeTexture(gl.TEXTURE3);
      if (
        this.backdrop &&
        (this.backdrop.width !== this.width ||
          this.backdrop.height !== this.height)
      ) {
        gl.deleteTexture(this.backdrop.texture);
        this.backdrop = undefined;
      }
      this.backdrop ??= this.texture(this.width, this.height);
      gl.bindTexture(gl.TEXTURE_2D, this.backdrop.texture);
      gl.copyTexSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        0,
        0,
        this.width,
        this.height,
      );
      gl.activeTexture(gl.TEXTURE0);
      gl.disable(gl.BLEND);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`GPU rendering error ${error}`);
  }
  dispose() {
    if (this.maskTexture) this.gl.deleteTexture(this.maskTexture.texture);
    if (this.matteTexture) this.gl.deleteTexture(this.matteTexture.texture);
    if (this.backdrop) this.gl.deleteTexture(this.backdrop.texture);
    this.textures.clear();
    this.generators.clear();
    this.targets.forEach((t) => this.gl.deleteTexture(t.texture));
    this.gl.deleteFramebuffer(this.fbo);
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
