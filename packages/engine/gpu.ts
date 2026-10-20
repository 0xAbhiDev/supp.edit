import type { Clip, Project } from "../project-schema";
import { animated } from "../commands";
import { LruCache } from "./lru";

const vertex = `#version 300 es
in vec2 a_position;
uniform vec2 u_output;
uniform vec4 u_rect;
uniform vec4 u_transform;
out vec2 v_uv;
void main(){
  v_uv=a_position;
  vec2 local=u_rect.xy+a_position*u_rect.zw;
  float cs=cos(u_transform.z),sn=sin(u_transform.z);
  vec2 position=vec2(cs*local.x-sn*local.y,sn*local.x+cs*local.y)*u_transform.w+u_transform.xy;
  gl_Position=vec4(position.x/u_output.x*2.0-1.0,1.0-position.y/u_output.y*2.0,0,1);
}`;
const fragment = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform int u_pass;
uniform vec2 u_output;
uniform vec2 u_direction;
uniform float u_sigma;
uniform vec4 u_color;
uniform vec4 u_maskTransform;
uniform vec4 u_mask;
uniform int u_maskType;
uniform float u_opacity;
uniform vec2 u_project;
in vec2 v_uv;
out vec4 result;
vec4 sampleFrame(vec2 uv){if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return vec4(0);return texture(u_image,vec2(uv.x,1.0-uv.y));}
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
  rgb*=u_color.x;
  rgb=(rgb-0.5)*u_color.y+0.5;
  float luminance=dot(rgb,vec3(0.2126,0.7152,0.0722));
  rgb=mix(vec3(luminance),rgb,u_color.z);
  float mask=1.0;
  if(u_maskType>0){
    vec2 offset=v_uv*u_project-u_maskTransform.xy;
    float cs=cos(u_maskTransform.z),sn=sin(u_maskTransform.z);
    vec2 local=vec2(cs*offset.x+sn*offset.y,-sn*offset.x+cs*offset.y)/u_maskTransform.w;
    vec2 normalized=(local-u_mask.xy)/u_mask.zw;
    if(u_maskType==1) mask=float(all(greaterThanEqual(normalized,vec2(0)))&&all(lessThanEqual(normalized,vec2(1))));
    else {float d=length(normalized*2.0-1.0);float edge=max(fwidth(d),0.0001);mask=1.0-smoothstep(1.0-edge,1.0+edge,d);}
  }
  float alpha=pixel.a*u_opacity*mask;
  result=vec4(clamp(rgb,0.0,1.0)*alpha,alpha);
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
  private textures: LruCache<string, Texture>;
  private generators = new LruCache<string, Generated>(32 * 1024 * 1024, 24);
  private width = 0;
  private height = 0;
  private lost = false;
  constructor() {
    const gl = this.canvas.getContext("webgl2", {
      alpha: false,
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
      this.targets.reduce((n, t) => n + t.width * t.height * 4, 0)
    );
  }
  begin(width: number, height: number) {
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
    gl.clearColor(0, 0, 0, 1);
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
    gl.uniform4f(this.uniform("u_transform"), 0, 0, 0, 1);
  }
  private generated(p: Project, c: Clip): Generated {
    const key = JSON.stringify([
      c.kind,
      c.kind === "text" ? c.text : c.shape,
      this.width / p.settings.width,
    ]);
    const cached = this.generators.get(key);
    if (cached) return cached;
    const canvas = document.createElement("canvas"),
      ctx = canvas.getContext("2d")!;
    let width = c.shape.width,
      height = c.shape.height,
      left = -width / 2,
      top = -height / 2;
    if (c.kind === "text") {
      ctx.font = `${c.text.weight} ${c.text.size}px ${c.text.font}`;
      width =
        Math.max(
          1,
          ...c.text.content
            .split("\n")
            .map((line) => ctx.measureText(line).width),
        ) + 8;
      height =
        Math.max(1, c.text.content.split("\n").length) * c.text.size * 1.2 + 8;
      left =
        c.text.align === "left"
          ? -4
          : c.text.align === "right"
            ? -width + 4
            : -width / 2;
      top = -height / 2;
    }
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
    if (c.kind === "text") {
      ctx.font = `${c.text.weight} ${c.text.size}px ${c.text.font}`;
      ctx.fillStyle = c.text.color;
      ctx.textAlign = c.text.align;
      ctx.textBaseline = "middle";
      const lines = c.text.content.split("\n");
      lines.forEach((line, i) =>
        ctx.fillText(line, 0, (i - (lines.length - 1) / 2) * c.text.size * 1.2),
      );
    } else {
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
  draw(p: Project, c: Clip, frame: number, source?: CanvasImageSource) {
    const gl = this.gl,
      t = animated(c, frame),
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
      const a = p.assets.find((a) => a.id === c.assetId);
      if (!a || a.kind === "audio") return;
      const fit = Math.min(
        p.settings.width / a.width,
        p.settings.height / a.height,
      );
      width = a.width * fit;
      height = a.height * fit;
      left = -width / 2;
      top = -height / 2;
      input = source as TexImageSource;
      key = c.id + ":" + a.fingerprint;
    }
    const dimensions = input as HTMLVideoElement &
      HTMLImageElement &
      HTMLCanvasElement;
    const w =
        dimensions.videoWidth || dimensions.naturalWidth || dimensions.width,
      h =
        dimensions.videoHeight || dimensions.naturalHeight || dimensions.height;
    let texture = this.textures.get(key);
    if (!texture) {
      texture = this.texture(w, h);
      if (!this.textures.set(key, texture, w * h * 4))
        throw new Error("Source texture exceeds GPU cache budget");
    }
    gl.bindTexture(gl.TEXTURE_2D, texture.texture);
    const stamp =
      input instanceof HTMLVideoElement
        ? input.currentTime
        : input instanceof ImageBitmap
          ? frame
          : 0;
    if (texture.stamp !== stamp || texture.input !== input) {
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
    gl.uniform4f(
      this.uniform("u_rect"),
      left * scale,
      top * scale,
      width * scale,
      height * scale,
    );
    gl.uniform4f(
      this.uniform("u_transform"),
      (p.settings.width / 2 + t.x) * scale,
      (p.settings.height / 2 + t.y) * scale,
      (t.rotation * Math.PI) / 180,
      t.scale,
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
    gl.uniform4f(
      this.uniform("u_maskTransform"),
      p.settings.width / 2 + t.x,
      p.settings.height / 2 + t.y,
      (t.rotation * Math.PI) / 180,
      t.scale,
    );
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const error = gl.getError();
    if (error !== gl.NO_ERROR) throw new Error(`GPU rendering error ${error}`);
  }
  dispose() {
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
