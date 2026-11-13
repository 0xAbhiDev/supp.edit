# Reference-to-Edit capability evidence — 13 November 2026

The Windows editor creates editable sequences from reference measurements and selected raw footage. The accepted cases include an earlier four-shot gym edit and an eight-shot coastal workflow. The two newly supplied gym Reels expose further typography and style gaps.

| Capability | Evidence and practical boundary |
| --- | --- |
| Three editing modes | Earlier four-shot gym reference passed actual Windows import/analyze/preview/apply/revise/undo/redo/save/full restart/reopen and separate MP4 exports. All three coastal modes also passed full restart, reopen and separate Windows Deliver exports. Each has eight editable shots with different pacing and trims. |
| Safe framing | Coastal fill framing eliminates unwanted side bars in decoded outputs. Protected subject geometry limits automatic zooms and transition movement. Wide groups can still require preserved borders instead of unsafe cropping. |
| Flash / blur | Actual decoded coastal footage shows a flash at 2 seconds and blur at 4 seconds in the controlled transition fixture. Editable ordinary shapes/effects survive native serialization. The controlled reference is an engineered treatment on real footage, not an unrelated natural-style acceptance. |
| Zoom / whip / motion | Six encoded controller peaks match authored camera animation better than disabled controls. Parameters and parent controllers are editable. Unsafe cases use disclosed blur fallback. Automated output classification still calls some of these cuts; recognition is approximate. |
| Grading | Bounded per-shot brightness/contrast/saturation/temperature and vignette proxies work. Neutral-source saturation amplification was corrected. Exact LUT, skin isolation, selective lighting and cinematic grade recovery are unsupported. |
| Color consistency | A real HLG raw source exposed CPU/GPU differences. A shared sRGB source surface fixes three actual SDR/HLG parity samples to below 0.37/255 before compression. All nine sampled frames across three corrected desktop MP4s agree with the CPU preview within 2.44/255 mean pixel error. Delivery is 8-bit SDR. |
| Text | Prior simple gym titles and kinetic typography passed native rendering/editability acceptance. New OCR and placement fixes preserve short/overlapping words and horizontal layout. Ornate, video-filled, partially hidden and rapidly animated lettering is not reliably recovered. |
| Creator labels | Recurring edge-label candidates are flagged using repeated text/geometry evidence, excluded from caption recreation and disclosed. This heuristic can need manual review. It does not infer ownership or remove watermarks from source media. |
| Color flashes | Two inversions in the supplied second gym reference are measured at 4633–4700 and 4767–4833 ms, avoiding four false shot boundaries. The desktop MP4 reproduces the two two-frame negative duotones with editable color layers and raw-source luma mattes. The measured palette approximates the treatment. Exact selective color and subject masks remain unsupported. |
| Speed / music | Existing bounded editable speed curves and measured onset placement work. Original optical speed curves, optical-flow interpolation, pitch-preserving retiming and inferred music licensing are not provided. No music-sync claim is made for the coastal reference without supplied music. |
| Subject effects | Automatic silhouette fills, accurate subject segmentation, text behind a person, advanced tracked masks, particle/3D treatments and object replacement are unsupported in this workflow. |
| Source isolation | Planned/rendered media sources are restricted to selected raw footage and supplied audio. Recursive verification rejects reference or unknown asset paths. Reference video remains available only for analysis/comparison. |

## Export evidence

Open test-results/reference-coastal/reviewed/Three-modes.supp for the editable coastal timeline. The before/after snapshots agree on every asset and composition, including manual brightness 0.96. The final Windows renders, inspection sheets, per-shot measurements and decoded checks are in test-results/reference-coastal/final.

| Mode | Frames | Duration | Maximum sampled preview error | Fully black / dark side-bar frames |
| --- | ---: | ---: | ---: | ---: |
| Close Match | 528 | 17.600 s | 2.34/255 | 0 / 0 |
| Smart Adaptation | 591 | 19.700 s | 2.44/255 | 0 / 0 |
| Creative Remix | 491 | 16.367 s | 2.22/255 | 0 / 0 |

All coastal MP4s decode as 1280 × 498 H.264 video with audible AAC. All seven boundaries were classified as cuts in each decoded output. Close Match reproduces every cut start within 16.34 ms. Smart Adaptation extends holds by up to 1.89 s in cumulative timing and Creative Remix shifts boundaries by up to 0.99 s. The horizon, rocks and beach fill the frame. Boats, birds, aerial views and the reference's turquoise water cannot be recovered from the two ground-level raw clips. The coastal reference contains no typography or music to match.

The controlled flash/blur and camera tests use real footage with known authored transitions. See test-results/reference-transitions/reviewed/Close-Match and test-results/reference-motion/render-check. Six encoded controller peaks match the authored motion better than the disabled controls. The detector still classifies the softer output peaks as cuts. Natural travel edits with these transitions remain an open acceptance case.

## Supplied gym Reels

The five independent raw takes include squat, bench, incline, deadlift and row. The separate music asset is the soundtrack. Text baked into some raw exercise clips remains visible and may be cropped. It cannot be edited like a generated title. Original-word mode currently reproduces recognized words, so incorrect or missing OCR requires manual review.

- The first Close Match MP4 under test-results/reference-user54/multi-raw/reserved/Close-Match lasts 506 frames (16.867 s). The compositor and native encoder cover all eight measured intervals after reserving capacity for the long final hold. Side-by-side inspection shows the right cut timing but several missing, doubled or misspelled lyric fragments.
- The second Close Match MP4 under test-results/reference-user55/multi-raw/validated/Desktop was exported through Windows Deliver after opening the editable three-mode project. It has four shots and 392 frames (13.067 s). All frames decode and none is fully black. First/middle/last mean preview error is at most 1.92/255. Frames 139–140 and 143–144 contain the two measured color pulses. Against a render with both pulse layers disabled, the active-frame error exceeds 74/255 in grayscale. With the authored layers enabled it stays below 0.41/255. Adjacent normal frames are identical with the controls enabled or disabled before encoding.
- Full visual recreation of both references remains incomplete. The second output misses much of the ornate lettering and branded end card. The subject silhouette, text behind the athlete, relief/texture inside lettering, precise fonts and original speed curves remain capability gaps.

## Next acceptance cases

Each supplied reference now has three separate, decoded H.264/AAC exports. In Close Match, Smart Adaptation and Creative Remix order, the first sequence lengths are 506, 514 and 436 frames. The second lengths are 392, 410 and 384. These six outputs used the production compositor and native encoder. The separate Windows Deliver run for the second Close Match is in `validated/Desktop`. Each comparison sheet shows reference shots above the generated shots. The first reference's gym clips retain narrow side borders on several shots, including 194 frames in Close Match. Side-bar acceptance applies to the coastal case.

Review title wording now allows the user to correct or remove individual recognized titles before Apply. Updating the preview preserves the source trim, styling and title interval. Browser acceptance changed a two-word title to three words and verified Apply, Undo, Redo, save and reopen. This addresses correction of proposed wording. Automatic recognition of missed lettering still needs work.

Improve recognition of uncertain words and text spanning cuts. Test foreground masks and text occlusion on independent moving subjects. Compare unrelated natural travel, lifestyle, talking-head and cinematic references through the complete native workflow. Track color error, layout agreement and cut timing separately. The current confidence values measure rule evidence and have no calibrated overall style score.
