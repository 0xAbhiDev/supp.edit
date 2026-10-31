# Local vision validation

The validated pack now feeds actual gym rough-cut selection. Five real exercise videos and a flower-video negative were analyzed through the native pipeline; broad evidence gates reject the unrelated footage. See [GYM_ACCEPTANCE.md](GYM_ACCEPTANCE.md) for scored components, sources and complete preview/apply/reopen/native-encode evidence. This remains a small regression set, not a general accuracy certification.

The application now uses the **fp32 MobileCLIP-S0 image encoder**, its paired quantized text encoder and tokenizer from the same pinned conversion, and **YOLOX Nano**. Model installation is explicit. No media is uploaded. These are sampled visual signals, not exact exercise or rep-phase recognition.

Checkpoint validation: production frontend build, 90 TypeScript tests, 26 Rust tests, and workspace Clippy with warnings denied all pass. The native desktop crate compiles. The refreshed desktop executable and full rough-cut acceptance remain pending.

## Failures and corrections

The quantized image encoder produced unrelated matches on real gym images despite the published input contract. The converter's config explicitly selects fp32 for the image branch. The fp32 replacement restores useful cross-modal ranking. It is 45,543,630 bytes (SHA-256 `17d3c037b1d488c10c50e09f6009ea5a198caef4e0e8f4ea5617b7cb2d067ac0`). Text/tokenizer remain from revision `757d59c9c6870a76a4b0306f05f5061bca15c39f` of [Xenova/mobileclip_s0](https://huggingface.co/Xenova/mobileclip_s0).

YOLOX's source tag contains an older normalized demo, but its release assets use the newer raw BGR contract. The [release notes](https://github.com/Megvii-BaseDetection/YOLOX/releases/tag/0.1.1rc0) explicitly describe this incompatibility. Correcting this restored person detection. Do not reintroduce ImageNet normalization for these pinned weights.

## Model-specific contracts

`vision_spec.rs` declares the independent contracts; diagnostics use the same processing functions as production.

| Model | Input | Resize / normalization | Output |
| --- | --- | --- | --- |
| MobileCLIP S0 image | `pixel_values`, float32 NCHW 1×3×256×256, RGB | Bilinear shortest edge 256, center crop, divide 255; no mean/std | `image_embeds`, 1×512, L2 normalized |
| Paired text encoder | `input_ids`, int64 N×77 | Matching CLIP tokenizer; NFC/whitespace/lowercase; BOS 49406, EOS 49407, zero padding; truncation retains EOS | `text_embeds`, N×512, L2 normalized |
| YOLOX Nano / Tiny | `images`, float32 NCHW 1×3×416×416, **BGR** | Aspect-preserving bilinear resize, top-left placement, bottom/right padding 114; **raw 0–255** | `output`, 1×3549×85; decode grids/strides 8,16,32; objectness × class score |

Boxes are decoded back through the letterbox scale to normalized source coordinates, clamped to the image. Detection threshold is 0.30, class-aware NMS IoU 0.45. Model scores remain uncertain: for example, the object vocabulary cannot identify barbells/kettlebells and may classify one as a ball or frisbee. Such labels are not equipment facts or a basis for lift classification.

## Measured comparison

Five real images were processed through the native `vision_probe` harness: an outdoor kettlebell frame, two bench-press images with multiple/partly occluded people, a beach with no people, and YOLOX's dog/bicycle/vehicle sample. Source and box-overlay PNGs were visually inspected, including the letterboxed model input. This is a small regression set, **not a population accuracy estimate**.

Measured on the development host, debug build, four intra-op threads, installed CPU runtime. Inference numbers include corresponding Rust preprocessing; cold start includes model sessions. Process peak working set was sampled every 100 ms. Runs are sequential and warm file-system caches differ.

| Configuration | Image model | Detector | Mean image ms | Mean detector ms | Session cold start ms | Peak RAM MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Selected fp32 + Nano | 43.43 MiB | 3.49 MiB | 206.6 | 231.0 | 1057.3 | 281.8 |
| fp32 + Tiny | 43.43 MiB | 19.28 MiB | 201.4 | 265.9 | 886.8 | 301.1 |
| Rejected quantized image + Nano | 11.30 MiB | 3.49 MiB | 292.7 | 246.1 | 793.7 | 248.2 |

Both detectors found both people in the gym image and at least three in the partially occluded/cropped support image, with plausible inspected boxes. Both returned zero people on the two negative images. Nano also found the distant person in the outdoor frame; Tiny missed that person and added a low-confidence partial duplicate in the support image. Nano is retained because Tiny did not improve this regression set and cost more memory/time. Small or occluded subjects remain difficult. Cross-class false positives remain visible in diagnostics.

The full-precision pair ranks gym images above the beach for gym/bench/weights queries and beach imagery above gym for beach queries. Detector evidence is necessary for generic person queries. Similarity alone is insufficient for barbell queries; descriptions and validated context contribute. The captured quantized outputs fail the broad training evidence gate. Captured native outputs are in `tests/fixtures/vision-validation.json`; regression tests exercise detector sanity, coordinate bounds, query ordering and rejection of failed/irrelevant evidence. They do not replace running inference on new footage.

## Evidence gates

Specific labels appear as **Likely** only with cosine ≥0.22, relative candidate support ≥0.45 and ≥0.015 margin over the next label. Otherwise the UI explicitly reports an uncertain closest match. Relative support is softmax over this vocabulary (temperature 0.02), **not a calibrated probability**.

Broad active-training candidacy requires a detected person ≥0.55, box area ≥2.5%, active-label cosine ≥0.21, ≥0.02 margin against unrelated contexts, and combined active-training candidate support ≥0.55. Setup/rest/pose alternatives remain in the denominator. Video motion and quality must additionally inform moment selection; a still cannot establish an active rep. A filename alone cannot pass the gym gate. Missing evidence stays missing. No exact lift, rep phase, face identity, occlusion or camera-shake certainty is invented.

## Execution providers and diagnostics

The installed, checksum-verified runtime is ONNX Runtime 1.31.1 **CPU**. Session setup can register CUDA, then DirectML, then CPU when those providers exist in the loaded runtime, with explicit registration failure before fallback. `SUPP_AI_EXECUTION_PROVIDER` accepts auto/CPU/CUDA/DirectML for host diagnostics. GPU dependencies are not auto-downloaded; CUDA/DirectML timings are **unavailable**, not fabricated. Provider selection in diagnostic reports reflects actual successful session setup (individual unsupported GPU operators may still fall back to CPU).

Opt-in harness: `cargo run -p supp-media --example vision_probe -- MODEL_ROOT FIXTURE_DIRECTORY OUTPUT_DIRECTORY DETECTOR_ONNX IMAGE_ENCODER_ONNX`. Then `node scripts/vision-report.mjs OUTPUT_DIRECTORY`. It writes original frames, actual resized inputs, box overlays, dimensions, scores, normalized embeddings, query comparisons, model paths, provider details and timings. Latest local artifacts: `test-results/vision/nano-fp32/index.html` and sibling reports. No inference happens in the HTML report.

Fixtures: [Kettlebell racked squat](https://commons.wikimedia.org/wiki/File:Kettlebell_racked_squat.webm), Taco Fleur / Cavemantraining, CC BY-SA 4.0, extracted frame; [Bench press with support](https://commons.wikimedia.org/wiki/File:Bench_press_with_support.jpg), jason.lengstorf, CC BY 2.0; [Bench press 1](https://commons.wikimedia.org/wiki/File:Bench_press_1.jpg), Lance Cpl. Ronald W. Stauffer / USMC, public domain; [Beach parasols without people](https://commons.wikimedia.org/wiki/File:Beach_parasols_without_people.jpg), Rosendahl, public domain; [YOLOX dog demonstration image](https://github.com/Megvii-BaseDetection/YOLOX/blob/main/assets/dog.jpg), upstream test asset. Images/models are development artifacts, not bundled in project files or the source archive. Source metadata and hashes were recorded in `work/vision/fixtures/provenance.json`.
