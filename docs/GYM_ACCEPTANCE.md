# Gym rough-cut acceptance — 1 November 2026

Both requested prompts use the same local brief parser, analysis service and planner. The exact first prompt selected seven non-overlapping ranges across five real exercise clips: 27.5 seconds, six shot endings near measured strong onsets. A requested duration is a target; insufficient usable ranges produce a shorter edit and an explicit warning, never repeated frames or fabricated activity.

## Evidence and scoring

Native vision/quality analysis ran on five exercise videos and a real flower-video negative using the validated MobileCLIP/YOLOX pack. Actual captures are in `tests/fixtures/gym-analysis.json`. Browser acceptance reuses these source-bound captures because native inference is a desktop capability; it does not simulate inference. Windows GUI smoke is pending.

Candidate windows are non-overlapping, at most six seconds and at least 1.5 seconds, inside measured scenes. Broad training eligibility uses the documented vision gates plus measured mean frame difference ≥0.001. Mostly dark or frozen windows are rejected. Components remain visible: 25% broad training similarity, 15% prompt relevance, 20% subject confidence/area/centrality/clipping, 15% motion, 15% log-scaled sharpness, 10% exposure. These are heuristics, not probabilities. Equipment recognition, occlusion and camera shake remain unavailable; camera movement can contribute to measured motion.

Selection subtracts up to 0.16 for visual similarity (cosine 0.75–1) or repeated source context, never repeating a candidate. The strongest-ranked moment opens. Pacing proposes lengths; measured strong onsets/beats within 120/300/650 ms for loose/balanced/tight sync may adjust endings while preserving source handles and duration bounds. Strong events are the upper 35% of measured strengths, minimum 0.35. No downbeat grid is invented. Original audio remains at 0 dB and chosen music starts at zero at -14 dB; both remain editable.

## Passed checks and limits

`tests/e2e/gym-edit.spec.ts` passes actual thumbnails, detached playback/seek preview, Apply creating real sequence/tracks/clips/source ranges/music/markers, exact Undo/Redo, normal Edit timeline, save/close/reopen with identical sequence data, the second prompt creating the next numbered sequence, and real non-gym rejection. Loading saved sequences exposed and fixed an immutable-store/scoped-selector React loop, now covered by a regression test.

Native read/save/read preserves v9 project data identically. The frontend compositor rendered all 825 frames; the native encoder encoded them and nested audio. FFprobe/decoded pixels verified 180×320, 30 fps, 825 frames, 27.5 seconds, H.264 + AAC, audio RMS 0.02192. Preview/export mean pixel errors at frames 0, 412 and 824 are below 0.93/255. This is functional acceptance at low resolution, not 1080p/4K performance certification.

Artifacts: `test-results/gym/GYM_EDIT.supp`, `NATIVE_REOPEN.supp`, `project.supp` (export graph), `render.mp4`, `verification.json`, `plan.png`, `timeline.png`. The timeline is never flattened/reimported. Windows GUI acceptance, revisions, reframing, time remapping and automatic requested captions remain active work. Unsupported speed/caption requests produce explicit limitations.

## Attribution

Four exercise excerpts share an original production, camera setup and performer; they are not independent filming sessions. FitnessScape, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/): [bench press](https://commons.wikimedia.org/wiki/File:Bench_press_-_exercise_demonstration_video.webm), [deadlift](https://commons.wikimedia.org/wiki/File:Deadlift_-_exercise_demonstration_video.webm), [incline press](https://commons.wikimedia.org/wiki/File:Incline_press_-_exercise_demonstration_video.webm), [bent-over row](https://commons.wikimedia.org/wiki/File:Bent-over_row_-_exercise_demonstration_video.webm). Taco Fleur / Cavemantraining: [kettlebell racked squat](https://commons.wikimedia.org/wiki/File:Kettlebell_racked_squat.webm), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The demonstration trims/reorders these sources, scales into a vertical frame and adds original generated PCM music. Retain credits and CC BY-SA 4.0 terms when sharing this derived demo. Media/models are excluded from source distribution. `work/gym/provenance.json` records URLs, licenses and hashes. Existing local flower footage is only a negative development fixture.
