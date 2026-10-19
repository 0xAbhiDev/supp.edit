# Project format v1

`.supp` and `.suppedit` files contain UTF-8 JSON. `schemaVersion: 1` is mandatory. Both native and frontend readers reject unsupported versions and malformed graph references. Unknown newer versions are not silently rewritten. No legacy version exists yet; migrations must be explicit pure functions with before/after fixtures when version 2 is introduced.

Root fields: `id`, `name`, `createdAt`, `modifiedAt` (UTC ISO timestamps), `settings`, `assets`, `tracks`, `clips`, `markers`. Settings store width/height, `{num, den}` FPS, and `colorSpace: "srgb"`.

All timeline positions and durations are **integer project frames**. Rational rate conversion happens at media boundaries; source time = `(sourceIn + timelineFrame - clip.start) * fps.den / fps.num`. Timecode labels are non-drop-frame, including at 29.97 / 59.94. VFR sources are sought by timestamp through the webview.

Assets contain original local paths, metadata, a UUID, and a lightweight fingerprint (path/name + size + modification time). Fingerprints are duplicate heuristics, not content hashes. Browser blobs are stored separately in IndexedDB under the asset UUID. Portable browser project files need source relinking outside the original browser.

Tracks define ordering, kind, lock, visibility, mute, and solo. Video tracks higher in the list composite above lower tracks. Within one track, later clips in graph order composite above earlier overlapping clips. Audio tracks accept audio assets only; video clips retain their linked original audio. This release has no unlink operation.

Clips define asset references or generated text/shape content, timeline placement, source offset, gain (dB), transform, color/blur parameters, mask, and keyframes. Transform position is in project pixels relative to canvas center. Scale is a multiplier. Opacity is 0–1. Masks are normalized project-space rectangles/ellipses in the layer's transformed coordinates; feather, arbitrary paths and inversion are not implemented.

Animation keys have a relative integer frame, numeric value, and interpolation (`linear`, `hold`, `ease-in-out`). Negative and beyond-end keyframe times are deliberately retained after splitting/trimming to preserve eased interpolation exactly. Inspector rows show keys inside the clip. These out-of-range keys are not invalid data.

Native validation caps project files at 64 MiB on read and rejects duplicate IDs, missing references, incompatible track kinds, invalid values and source overruns. The TypeScript and Rust models share a fixture in `tests/fixtures/project.supp`; keep both schemas synchronized.

Save writes a sibling temporary file, flushes it, and atomically replaces the destination. A previous-save `.supp.bak` is kept. Native autosave rotates five independent recovery JSON files in the app data directory. Recovery opens as unsaved and requests a new save location so a recovery file cannot smuggle a write destination. Project files do not embed thumbnails, decoded frames or media buffers.
