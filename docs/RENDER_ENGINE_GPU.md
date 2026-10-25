# Current render engine

The automatic renderer is a **WebGL2 texture compositor** inside the current webview, with Canvas2D fallback. Media surfaces upload to textures, transforms and masks run in shaders, and separable Gaussian blur uses two framebuffers. Generated text/shapes use cached raster textures. The resulting GPU canvas is presented through the monitor canvas; preview does not call CPU pixel readback. This is not native wgpu or zero-copy native decoder integration. WebGL can select a software device; diagnostics report the actual context device.

For each frame, find clips in `[start, start + duration)`, load active media, seek to the rational source timestamp, process tracks bottom-to-top, apply transform, opacity, mask, blur/brightness/contrast/saturation and draw media or generated text/shape content. Masks are applied in layer coordinates. This uses the webview's sRGB 8-bit compositing and canvas filter behavior, with no claimed ACES/HDR/linear-light accuracy.

Resources are keyed by clip ID and media fingerprint so overlapping clips from one source have independent decoders. Resources have a hard 24-entry limit and prune idle entries toward 12. Paused/export frame snapshots use a 96 MiB / 96-entry LRU; borrowed bitmaps are retired after their render finishes. Texture storage is limited to 128 MiB / 48 entries, generated text/shape surfaces to 32 MiB / 24 entries, and framebuffer pairs to 256 MiB. These count owned allocations, not all driver or webview decoder memory. Upcoming sources within one second are prefetched with at most two concurrent loads; this preloads media elements, not a native frame decode worker.

Playback resolution can be full, half, or quarter in each dimension. PNG and MP4 always use full project resolution. Renderer selection and preview resolution persist locally. GPU initialization, allocation, or context loss switches to CPU and records the reason. Changing renderer cancels stale presentation before disposing borrowed resources.

Native thumbnail/waveform analysis runs off the UI thread with a serialized worker, per-process deadlines, and a fingerprinted 256 MiB / 2,000-file cache. Browser waveform binning uses a Web Worker after audio decoding, limited to 64 MiB sources / ten minutes; IndexedDB derived data has a 64 MiB / 512-entry budget. The 400-bin waveform is an overview, not sample-accurate audio editing. Browser relink stores old and new source blobs under their fingerprints so undo restores actual source bytes and derived previews.

Preview coalesces pending requests. HTML media playback and Web Audio gain produce sound. A frame-based monotonic clock drives project time; media clocks are resynchronized if they drift by more than 120 ms. Reverse shuttle seeks silently. This is functional playback, not a frame-perfect native decoder or sample-accurate DAW transport.

## MP4

1. Freeze and validate a project snapshot. Require explicit save-path selection.
2. Native code revalidates permitted source paths and rejects writing over original media.
3. Create a sibling temporary MP4. Spawn FFmpeg with an image2pipe PNG input at the rational project rate.
4. Seek and render each output frame. Send binary PNG bytes through IPC. Native code validates signature, dimensions and frame count; writes provide backpressure.
5. For each audible clip, trim source audio with `-ss`/`-t`, resample to 48 kHz, reset timestamps, apply dB gain and timeline delay, then mix and limit. Mute, solo and hidden video tracks are respected. Empty audio gets silence.
6. Close the image pipe, wait for a successful encoder exit, require a nonempty file, and atomically publish the result. Errors/cancellation kill the child and remove its temporary output.

H.264 `libx264`, CRF 18, medium preset, yuv420p, AAC 192 kbps, and faststart are the current fixed encoding profile. Separate bounded tests exercise NVENC/QSV/AMF encoding and CUDA/QSV/D3D11 decoding with three H.264 frames. A passing probe does not change the active exporter or webview decoder. Output dimensions must be even. Export is one foreground job, not a persistent multi-output queue. Cancellation is checked between frames; final muxing cannot currently be interrupted from the UI after it has begun.

Validation renders a known animation, then a 60-frame composition with real MP4, PNG, title, mask, effects, keyframes, and WAV audio. The resulting MP4 is decoded to check dimensions, frame count, audio and visual agreement. Deterministic project data does not imply pixel-identical typography across different operating systems using generic system fonts.
