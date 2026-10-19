# supp.edit

A local-first creative workstation built with **Tauri 2, Rust, React, and TypeScript**. This repository contains a working early editing slice, not the entire long-term suite described in the product brief. The application opens with an empty project and operates on media you import.

## Start

Requirements: Node 22+, Rust 1.90 (automatically selected by `rust-toolchain.toml`), platform [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), and FFmpeg / FFprobe for native media import and MP4 encoding.

```sh
npm install
npm run setup:media   # optional Windows media tools; see THIRD_PARTY.md
npm run dev
```

Alternatively, provide `ffmpeg` and `ffprobe` on PATH or set `SUPP_FFMPEG` and `SUPP_FFPROBE` to full executable paths. On Windows, `setup:media` downloads the current Gyan essentials build linked by FFmpeg, verifies the publisher's SHA-256, and extracts the two tools into `work/media-tools`. It does not install system-wide software or bundle codecs into the application. On macOS/Linux, install FFmpeg using your platform package manager.

```sh
npm run dev:web       # local web companion, IndexedDB media, PNG export
npm run build         # TypeScript checks + production frontend
npm run build:desktop # platform installer; unsigned until signing is configured
npm run launch        # launch a previously built desktop binary
npm run doctor        # report native tool availability
```

The Windows development executable supplied in `bin/` embeds the frontend and does not need a Vite server. Double-click **Start supp.edit.cmd** in this folder to launch it with the configured media tools, or use `npm run launch`. WebView2 and Node must be installed for this launcher. The executable is an unsigned development build. The source ZIP excludes generated executables and downloaded tools; build it and run media setup after extracting the source elsewhere.

## Working features

- Versioned `.supp` project graph with validation, rational frame rates, linked media, atomic native saves, a previous-save backup, and five rotating native recovery snapshots.
- Native file picker, real FFprobe metadata, native thumbnails, duplicate-file detection, missing-media errors, and explicit relinking. Browser imports store blobs locally in IndexedDB.
- Source monitor and a canvas program monitor. Multitrack video/image/audio editing, split, bounded trim, drag move, horizontal timeline culling, snapping, markers, track locks, visibility, mute, solo, and track-local ripple delete.
- Reversible structural patch history, up to 500 editing commands, without copying media buffers.
- Text and shape layers; nondestructive translation, scale, rotation, opacity; linear, hold, and eased keyframes for X/Y/scale/opacity; rectangular and elliptical masks; blur, brightness, contrast, saturation; clip audio gain.
- Space and J/K/L playback, frame stepping, loop, safe margins, full-screen monitor, source preview, searchable command palette, resizable persisted panels, and dark/light themes.
- Actual MP4/H.264/AAC encoding through FFmpeg, from the same composited frames shown in preview, with trimmed/delayed/gained source audio. Progress is based on submitted frames. Cancellation removes the temporary output. PNG frame export also works in the browser.

## Use it

1. Create a project. Import MP4, PNG/JPEG, and WAV files.
2. Use an asset's **Insert** button to insert at the playhead, or drag it to a compatible track. Click its preview for the source monitor.
3. Select a timeline clip. Press **S** to split; drag edges to trim; drag its body to move. Use **Undo** / **Redo** as needed.
4. Add **Title**, **Shape**, or another video track. Edit appearance in the inspector. Click the diamond beside Position X, move the playhead, and change Position X to animate it.
5. Save as `.supp`, reopen, and relink any moved sources.
6. Open **Export**, choose **Export MP4**, and select a destination. The app must have an FFmpeg build with `libx264` and AAC.

The web companion downloads project JSON and persists media in the same browser profile. Moving that file to another browser/computer requires relinking sources. Browser storage is not a backup.

## Current boundaries

This release is **8-bit sRGB, Canvas2D, system-webview decoding, and a single sequence**. It is not a GPU NLE, an HDR/color-managed grading system, or a complete image editor. “Composite”, “Color”, and “Audio” operate on the same graph; their controls are a limited subset, not full separate workstations. AI Studio is explicitly disabled. There is no simulated AI, transcription, RAW development, proxy engine, 3D, plugin execution, or cloud service.

The system webview must support the imported codec for preview and frame export; FFprobe's ability to inspect a file does not imply the webview can decode it. Transcode incompatible media to H.264/AAC MP4, WAV, or PNG. Reverse shuttle is silent. Browser FPS metadata is unavailable and is reported as such. Playback can drop visual frames under load; offline export seeks and renders every requested frame. It is not a sample-accurate professional audio transport. Export is one job at a time, at most 128 audible clips, no pause/retry queue, and 8-bit H.264 only.

Panel resizing is implemented; arbitrary docking, detachable panels, and multi-monitor layouts are not. Timeline clipping is culled horizontally; large-project vertical virtualization and performance certification remain future work. Image thumbnails are regenerated/cached independently of project data. Edits never rewrite original sources.

## Validation

```sh
npm test
npm run check
cargo test --workspace --exclude supp-desktop
# Set SUPP_FFMPEG and SUPP_FFPROBE, or use PATH for the following scripts:
node scripts/make-fixtures.mjs
npx playwright install chromium
npm run test:e2e
cargo run -p supp-export --example render_frames -- test-results/render-media
node scripts/verify-render.mjs test-results/render-media
```

Fixtures are synthesized by FFmpeg for tests only. They are never inserted into a user's project. The render verification decodes the actual MP4 and checks frame count, dimensions, AAC audio, audio energy, and pixel agreement with the compositor. See [VALIDATION.md](docs/VALIDATION.md) for this build's results and remaining validation gaps.

Architecture and extension points: [ARCHITECTURE.md](docs/ARCHITECTURE.md), [PROJECT_FORMAT.md](docs/PROJECT_FORMAT.md), [RENDER_ENGINE.md](docs/RENDER_ENGINE.md), [ROADMAP.md](docs/ROADMAP.md), [BUILDING.md](docs/BUILDING.md), [AI_ARCHITECTURE.md](docs/AI_ARCHITECTURE.md), [PLUGIN_API.md](docs/PLUGIN_API.md), [CONTRIBUTING.md](CONTRIBUTING.md), [THIRD_PARTY.md](THIRD_PARTY.md).
