# Ordered effect validation — 29 October 2026

- 77 TypeScript tests and 22 Rust tests pass. Production TypeScript/Vite build and workspace Clippy pass (Vite retains its bundle-size warning).
- Two new effect browser cases pass. Ordered brightness/contrast produces center RGB 27; reversed order produces RGB 77. Mask-edge alpha spreads after blur. Nested masked/matted effect stacks animate, bypass, reorder, undo, save/reopen and export correctly. UI screenshot inspected.
- GPU/Canvas RGBA mean error is at most 1.873021/255 in the tested nested/blur/color fixture. Color stages in Canvas fallback use explicit channel math to avoid browser CSS coefficient quantization; only fallback reads pixels. WebGL keeps effect passes on the GPU.
- 60/60 PNG frames are byte-identical after reopening. Effect fallback surfaces release to zero on dispose. CPU working surfaces have a 128 MiB guard; GPU reuses its two existing bounded render targets.
- Native H.264/AAC encode: 320×180, 30 fps, 60 frames, two seconds, silent audio. Decoded RGB MAE 0.479421 / 0.415515 / 0.602610 at frames 0/30/59.
- Five matte/blend/GPU regressions and six mask/parent/timeline regressions pass. Native GUI open/save for the prior v6 build passed; v7 native persistence is validated by Rust and CLI encoding. The embedded v7 Windows executable has been rebuilt. No v7 GUI claim yet.
- The existing 1080p ten-layer SwiftShader profile exceeded its 120-second timeout. This remains a performance gap, not a successful profile. Physical GPU, 4K, sustained-load and cross-platform certification are open.

Evidence: ../verification/effects. Earlier histories and validation reports are retained.
