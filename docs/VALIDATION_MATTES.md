# Matte/blend validation — 29 October 2026

- 71 TypeScript tests; 21 Rust tests; TypeScript/Vite build; workspace Clippy with warnings denied pass.
- Three new browser cases pass: 17 modes with opaque/partial alpha, alpha/luma/inversions/inactive sources/chained mattes, animated nested masks, command UI, undo/redo, save/reopen and PNG export.
- Blend GPU/Canvas RGBA mean error is at most 0.625/255 across tested fixtures. Nested animated matte error at frames 0/30/59: 0.006007 / 0.019175 / 0.005916. All 60 PNG frames match byte-for-byte after reopening. Sample matte surfaces use 410400 bytes and release to zero.
- Native H.264/AAC encode: 320×180, 30 fps, 60 frames, two seconds; silent source RMS zero. Decoded RGB MAE: 1.727668 / 1.753900 / 1.756250 at frames 0/30/59.
- Native Windows build launched, opened the generated nested matte project, rendered the shaped/feathered result and saved through native persistence. Schema v6, source references and blend fields remain intact.
- Broader regression run: ten cases passed. The caption case passed on retry; the 1080p ten-layer software profile still exceeded its 120-second timeout. This performance investigation remains open. This is not a performance certification. Browser renderer uses Chromium/SwiftShader. Vite retains its >500 kB bundle warning.

Evidence: ../verification/compositing. Prior mask/parenting evidence remains available. Physical GPU, sustained large media, 4K, cross-platform packaging and complete compositor acceptance remain unverified.
