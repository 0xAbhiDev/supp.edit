# Current state — mattes and blends, 29 October 2026

Schema v6 reads v1–v6. Same-scope alpha/luma and inverted mattes work with hidden sources, source timing, nested compositions, animation, masks, effects and opacity. Sources are excluded from direct image output while referenced. Their audio follows track controls. Matte chains are validated against cycles, missing/nonvisual/cross-scope sources and depth limits in TypeScript, Rust and command history. Precompose requires a closed set of matte references; referenced sources cannot be deleted accidentally.

All 17 blend modes render on WebGL2 and Canvas fallback: normal, multiply, screen, overlay, darken, lighten, color dodge/burn, hard/soft light, difference, exclusion, hue, saturation, color, luminosity and clamped add. Inspector edits support Undo/Redo, persistence and export. AI context now includes explicitly projected mask/compositing metadata without paths or mutable project references.

Validation: 71 TypeScript tests and 21 Rust tests, production build and Clippy pass. Three new browser cases pass, with 60 byte-identical frames after reopening and real native H.264/AAC encoding. Native Windows launch/open/render/save passed; saved schema and nested references were inspected. See docs/VALIDATION.md for regression results. Evidence: ../verification/compositing. Earlier evidence and histories are retained.

Active subsystem: ordered effect stacks, followed by adjustment layers and Photo. Existing corrections and their 17-channel animation remain compatible. Ordered effects will run after masks and before matte/opacity/blend. The full compositor and product scope remain open: advanced layer gestures/handles, graph lanes for mask values, richer shapes/text, Photo, color/audio/RAW/3D/plugins and release hardening continue in priority order. No physical-GPU real-time/4K or cross-platform certification is claimed.

AI Studio currently executes local SRT captions with Preview/Apply/Undo and job progress. Provider/model/operation/privacy contracts exist; inference, remote transport, installs and OS credential storage are not implemented. No model download or upload occurs automatically.
