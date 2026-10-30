// Render opt-in native diagnostic evidence. This never performs inference or downloads a model.
import fs from "node:fs";
import path from "node:path";
const directory = path.resolve(
  process.argv[2] || "test-results/vision/nano-fp32",
);
const report = JSON.parse(
  fs.readFileSync(path.join(directory, "report.json"), "utf8"),
);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const html = `<!doctype html><meta charset="utf-8"><title>supp.edit · Vision diagnostics</title><style>
body{background:#11151b;color:#e8edf7;font:15px system-ui;margin:32px;max-width:1500px}h1{font-size:28px}article{border-top:1px solid #39414d;padding:24px 0}.frames{display:grid;grid-template-columns:2fr 1fr 1fr;gap:16px}img{max-width:100%;max-height:450px;object-fit:contain;background:#202732}figure{margin:0}figcaption{padding:8px 0;color:#b0bdd0}code,pre{white-space:pre-wrap;overflow-wrap:anywhere}td,th{text-align:left;padding:8px;border-bottom:1px solid #39414d}summary{cursor:pointer}p{max-width:1000px}</style>
<h1>Vision diagnostics · LOCAL</h1><p>Execution provider: ${esc(report.provider)} · model load ${report.coldStartMs.toFixed(1)} ms · text encoding ${report.textEncodingMs.toFixed(1)} ms. Timings include native preprocessing where applicable. Green boxes: person; orange: other model candidates. Detection scores are model confidence, not guaranteed truth.</p>
<details><summary>Active models, tensor shapes and preprocessing contracts</summary><pre>${esc(JSON.stringify({ image: report.imageModel, text: report.textModel, detector: report.detector, specs: report.specs, shapes: report.shapes }, null, 2))}</pre></details>
${report.results
  .map(
    (f) =>
      `<article><h2>${esc(f.source)}</h2><p>${f.width} × ${f.height} · image embedding ${f.embeddingMs.toFixed(1)} ms · detection ${f.detectionMs.toFixed(1)} ms</p><div class="frames"><figure><img src="${Number(f.index)}-boxes.png"><figcaption>Source with measured boxes · <a href="${Number(f.index)}-source.png">original input</a></figcaption></figure><figure><img src="${Number(f.index)}-detector-input.png"><figcaption>Detector letterbox · raw BGR tensor</figcaption></figure><figure><img src="${Number(f.index)}-clip-input.png"><figcaption>MobileCLIP RGB center crop</figcaption></figure></div><table><tr><th>Detection candidate</th><th>Model confidence</th><th>Normalized x / y / w / h</th></tr>${f.detections
        .map(
          (d) =>
            `<tr><td>${esc(d.label)}</td><td>${d.confidence.toFixed(3)}</td><td>${[
              d.bounds.x,
              d.bounds.y,
              d.bounds.width,
              d.bounds.height,
            ]
              .map((v) => v.toFixed(3))
              .join(" / ")}</td></tr>`,
        )
        .join(
          "",
        )}</table><details><summary>Image/text matches and candidate labels</summary><pre>${esc(JSON.stringify({ queries: f.queries, labels: f.labels }, null, 2))}</pre></details></article>`,
  )
  .join("")}`;
fs.writeFileSync(path.join(directory, "index.html"), html);
console.log(path.join(directory, "index.html"));
