/** What the reference's soundtrack was measured to contain, how its visual events relate to it,
 * and what the plan did with the audio. Measured values and inferred relations are labelled
 * separately; nothing here is a calibrated probability. */
import type { StyleDNA } from "../../../packages/ai/reference/dna";
import type { EditorToolCall } from "../../../packages/ai/editor-agent/registry";

/** A small bar for an evidence score (0–1), with the number beside it. */
function Meter({ value }: { value: number }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <span className="re-meter" title={`${Math.round(v * 100)} of 100 (rule evidence, not a calibrated probability)`}>
      <i>
        <b style={{ width: `${v * 100}%` }} />
      </i>
      {Math.round(v * 100)}
    </span>
  );
}
export function AudioEvidence({ dna, commands }: { dna: StyleDNA; commands: EditorToolCall[] }) {
  const create = commands.find((c) => c.tool === "sequence.create");
  const ai = create?.tool === "sequence.create" ? create.ai : undefined;
  const audio = dna.audio,
    graph = dna.eventGraph;
  if (!audio && !ai?.audioNotes?.length) return null;
  const counts = new Map<string, number>();
  for (const e of audio?.events ?? []) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const bpms = (audio?.tempo ?? []).map((t) => t.bpm).sort((a, b) => a - b);
  const visual = new Map(graph?.visual.map((v) => [v.id, v]) ?? []);
  const anchors = new Map(graph?.anchors.map((a) => [a.id, a]) ?? []);
  const pct = (v?: number) => (v === undefined ? "–" : Math.round(v * 100) + "%");
  return (
    <details>
      <summary>
        Audio events{ai?.audioMode ? " · " + { music: "supplied music", reference: "reference audio", recreate: "recreated audio structure" }[ai.audioMode] : ""}
      </summary>
      {audio && (
        <p>
          Measured: {audio.beats.length} beats
          {bpms.length ? ` · tempo ${Math.round(bpms[0])}–${Math.round(bpms[bpms.length - 1])} BPM` : ""} · beat evidence{" "}
          {pct(audio.beatConfidence)} ·{" "}
          {[...counts]
            .sort((a, b) => b[1] - a[1])
            .map(([k, n]) => `${n} ${k.replace("_", " ")}`)
            .join(", ")}
        </p>
      )}
      {graph?.grammar.cut && (
        <p>
          Inferred grammar: cuts on an audio event {pct(graph.grammar.cut.on)}, before {pct(graph.grammar.cut.before)}, after{" "}
          {pct(graph.grammar.cut.after)}, between beats {pct(graph.grammar.cut.offbeat)}, unrelated {pct(graph.grammar.cut.unanchored)} · on
          transients {pct(graph.grammar.cut.onTransient)} · on downbeats {pct(graph.grammar.cut.onDownbeat)}
          {graph.grammar.cut.medianBeatsPerShot !== undefined ? ` · ${graph.grammar.cut.medianBeatsPerShot} beats per shot (median)` : ""}
          {graph.grammar.title_in ? ` · titles on lyrics ${pct(graph.grammar.title_in.onLyric)}` : ""}
        </p>
      )}
      {!!ai?.audioNotes?.length && (
        <ul>
          {ai.audioNotes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      {graph && (
        <table>
          <thead>
            <tr>
              <th>Visual</th>
              <th>Reference</th>
              <th>Audio event</th>
              <th>Relation</th>
              <th>Measured offset</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {graph.links.slice(0, 80).map((l) => {
              const v = visual.get(l.visualId),
                a = l.anchorId ? anchors.get(l.anchorId) : undefined;
              return (
                <tr key={l.visualId}>
                  <td>
                    {v?.kind.replace("_", " ")}
                    {v?.label && v.kind !== "cut" ? " · " + v.label.slice(0, 24) : v?.label && v.label !== "cut" ? " · " + v.label : ""}
                  </td>
                  <td>{v ? (v.timeMs / 1000).toFixed(3) + "s" : ""}</td>
                  <td>{a ? `${String(l.inferred.anchor).replace("_", " ")} ${(a.timeMs / 1000).toFixed(3)}s` : "none"}</td>
                  <td>{l.relation}</td>
                  <td>{l.anchorId ? l.offsetMs + " ms" : ""}</td>
                  <td>
                    <Meter value={l.confidence} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {!!ai?.audioMapping?.length && (
        <table>
          <thead>
            <tr>
              <th>Visual</th>
              <th>Reference → adapted</th>
              <th>Trigger → replacement</th>
              <th>Kept relation</th>
              <th>Why (type · section · bar · strength · position)</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {ai.audioMapping.slice(0, 80).map((m, i) => (
              <tr key={i}>
                <td>{m.visual.replace("_", " ")}</td>
                <td>
                  {(m.referenceMs / 1000).toFixed(3)} → {(m.adaptedMs / 1000).toFixed(3)} s
                </td>
                <td>
                  {m.anchor.replace("_", " ")} →{" "}
                  {m.status === "anchored" ? m.replacement.replace("_", " ") : m.status === "free" ? <span className="re-tag">beat map</span> : <span className="re-tag warn">no suitable replacement event found</span>}
                </td>
                <td>{m.status === "anchored" ? `${m.relation} ${m.offsetMs >= 0 ? "+" : ""}${m.offsetMs} ms` : "—"}</td>
                <td>{m.reasons ? [m.reasons.type, m.reasons.section, m.reasons.phrase, m.reasons.strength, m.reasons.position].map((v) => v.toFixed(2)).join(" · ") : "—"}</td>
                <td>
                  <Meter value={m.confidence} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {audio?.tempoHypotheses && audio.tempoHypotheses.length > 1 && (
        <p>
          Tempo readings: {audio.tempoHypotheses.map((h) => `${Math.round(h.bpm)} BPM (${Math.round(h.confidence * 100)}%)`).join(", ")}
          {audio.tempoAmbiguous ? " · ambiguous" : ""}.
        </p>
      )}
      {audio && <p>Not measured: {audio.capabilities.notMeasured.join(", ")}.</p>}
    </details>
  );
}
