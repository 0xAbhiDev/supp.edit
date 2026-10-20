import {
  usePlayback,
  type RendererMode,
} from "../../../packages/engine/diagnostics";
import type { Capabilities } from "../../../packages/platform";
export function EngineDiagnostics({
  capabilities,
}: {
  capabilities: Capabilities | null;
}) {
  const s = usePlayback();
  return (
    <>
      <span className="eyebrow">PLAYBACK ENGINE</span>
      <label>
        Renderer
        <select
          aria-label="Renderer mode"
          value={s.mode}
          onChange={(e) =>
            s.configure({ mode: e.target.value as RendererMode })
          }
        >
          <option value="auto">Automatic · WebGL2 with CPU fallback</option>
          <option value="cpu">Canvas2D · CPU fallback</option>
        </select>
      </label>
      <dl>
        <dt>Renderer</dt>
        <dd>{s.renderer}</dd>
        <dt>Graphics device</dt>
        <dd>{s.gpu}</dd>
        <dt>Decoder</dt>
        <dd>System webview · hardware use not exposed</dd>
        <dt>Export encoder</dt>
        <dd>
          {capabilities?.encoders.includes("libx264")
            ? "FFmpeg libx264"
            : "Unavailable"}
        </dd>
        <dt>Playback resolution</dt>
        <dd>{s.scale * 100}% · export stays full resolution</dd>
        <dt>Render time</dt>
        <dd>{s.renderMs.toFixed(1)} ms</dd>
        <dt>Presented / skipped frames</dt>
        <dd>
          {s.rendered} / {s.dropped}
        </dd>
        <dt>Decoder dropped frames</dt>
        <dd>{s.decodedDropped}</dd>
        <dt>Frame cache / hits</dt>
        <dd>
          {(s.frameCacheBytes / 1048576).toFixed(1)} MiB / {s.frameCacheHits}
        </dd>
        <dt>Texture allocation</dt>
        <dd>{(s.textureBytes / 1048576).toFixed(1)} MiB</dd>
        <dt>Open media resources</dt>
        <dd>{s.resourceCount} / 24</dd>
      </dl>
      {s.fallback && <p className="setup-notice">{s.fallback}</p>}
      <span className="eyebrow">NATIVE HARDWARE PROBES</span>
      <dl>
        <dt>System RAM</dt>
        <dd>
          {capabilities?.machine.ramBytes
            ? `${(capabilities.machine.ramBytes / 1073741824).toFixed(1)} GiB`
            : "Not reported"}
        </dd>
        {capabilities?.machine.gpus.map((g, i) => (
          <div className="diagnostic-device" key={i}>
            <dt>GPU / dedicated VRAM</dt>
            <dd>
              {g.name} · {(g.dedicatedBytes / 1073741824).toFixed(2)} GiB
              {g.software ? " · software adapter" : ""}
            </dd>
          </div>
        ))}
      </dl>
      {capabilities?.machine.inventoryError && (
        <p className="field-hint">{capabilities.machine.inventoryError}</p>
      )}
      {capabilities?.machine.probes.map((p) => (
        <details key={p.kind + p.name}>
          <summary>
            {p.name} · {p.kind} · {p.available ? "Probe passed" : "Unavailable"}
          </summary>
          <p className="field-hint">{p.detail}</p>
        </details>
      ))}
      <p className="field-hint">
        WebGL may use a software device. The device name above reports the
        active context; FFmpeg's advertised APIs alone do not establish hardware
        support. Skipped frames count forward 1× playback gaps; decoder drops
        are reported separately.
      </p>
    </>
  );
}
