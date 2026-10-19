# Current render engine

The renderer is an explicit **CPU baseline**, not a claimed wgpu implementation. Browser/webview decoding feeds Canvas2D at project resolution. The same renderer is used for preview, still export and MP4 frames.

For each frame, find clips in `[start, start + duration)`, load active media, seek to the rational source timestamp, process tracks bottom-to-top, apply transform, opacity, mask, blur/brightness/contrast/saturation and draw media or generated text/shape content. Masks are applied in layer coordinates. This uses the webview's sRGB 8-bit compositing and canvas filter behavior, with no claimed ACES/HDR/linear-light accuracy.

Resources are keyed by clip ID and media fingerprint so overlapping clips from one source have independent decoders. The pool prunes inactive media elements above 24 cached entries; simultaneously active layers can exceed that count. Thumbnail and decoded media memory are not yet a complete configurable cache-budget system.

Preview coalesces pending requests. HTML media playback and Web Audio gain produce sound. A frame-based monotonic clock drives project time; media clocks are resynchronized if they drift by more than 120 ms. Reverse shuttle seeks silently. This is functional playback, not a frame-perfect native decoder or sample-accurate DAW transport.

## MP4

1. Freeze and validate a project snapshot. Require explicit save-path selection.
2. Native code revalidates permitted source paths and rejects writing over original media.
3. Create a sibling temporary MP4. Spawn FFmpeg with an image2pipe PNG input at the rational project rate.
4. Seek and render each output frame. Send binary PNG bytes through IPC. Native code validates signature, dimensions and frame count; writes provide backpressure.
5. For each audible clip, trim source audio with `-ss`/`-t`, resample to 48 kHz, reset timestamps, apply dB gain and timeline delay, then mix and limit. Mute, solo and hidden video tracks are respected. Empty audio gets silence.
6. Close the image pipe, wait for a successful encoder exit, require a nonempty file, and atomically publish the result. Errors/cancellation kill the child and remove its temporary output.

H.264 `libx264`, CRF 18, medium preset, yuv420p, AAC 192 kbps, and faststart are the current fixed encoding profile. Hardware APIs and encoder names are detected but no acceleration is assumed. Output dimensions must be even. Export is one foreground job, not a persistent multi-output queue. Cancellation is checked between frames; final muxing cannot currently be interrupted from the UI after it has begun.

Validation renders a known animation, then a 60-frame composition with real MP4, PNG, title, mask, effects, keyframes, and WAV audio. The resulting MP4 is decoded to check dimensions, frame count, audio and visual agreement. Deterministic project data does not imply pixel-identical typography across different operating systems using generic system fonts.
