Continue developing supp.edit from the CURRENT repository and CURRENT working build.

DO NOT restart the project.
DO NOT replace the existing architecture merely to make a cleaner demo.
DO NOT redesign the UI unless required for functionality.
DO NOT create placeholder buttons, fake AI, fake processing, or fake panels.

The current milestone is only the foundation.

You already have working:
- project creation/save/reopen
- .supp project format
- real media import
- multitrack timeline
- basic editing
- text/shapes
- some effects
- masks
- keyframes
- undo/redo
- crash/recovery functionality
- MP4 H.264/AAC export
- PNG output
- Windows development build
- automated tests

Now I want you to transform this from an early editor into a PROFESSIONAL CREATIVE ENGINE.

Before writing code:

1. Audit the complete repository.
2. Launch the current application.
3. Test every visible button and workflow.
4. Determine which controls are functional, partially functional, cosmetic, or broken.
5. Inspect the media/rendering architecture.
6. Inspect timeline performance architecture.
7. Inspect project serialization and undo architecture.
8. Inspect current tests.
9. Create CURRENT_STATE.md containing:
   - working features
   - partial features
   - missing features
   - architectural weaknesses
   - performance bottlenecks
   - technical debt
10. Then immediately continue implementation.

Do not stop after producing the audit.

==================================================
PHASE 2: PROFESSIONAL MEDIA + GPU FOUNDATION
==================================================

This is the highest priority.

Build a proper GPU-accelerated media/render pipeline.

Use the best architecture appropriate for the current codebase, preferably native Rust + wgpu where practical.

Implement real:

- GPU texture-based video compositing
- hardware-accelerated playback where supported
- hardware video decoding capability detection
- hardware encoding capability detection
- frame cache
- bounded LRU cache
- thumbnail cache
- waveform cache
- background decode workers
- frame prefetching
- asynchronous media loading
- proxy architecture
- playback resolution controls
- dropped-frame monitoring
- CPU fallback

Windows capability detection should consider:

- NVIDIA NVDEC/NVENC
- Intel Quick Sync
- AMD AMF
- available GPU
- available VRAM
- CPU cores
- system RAM

Do not assume hardware support.

Playback must remain responsive while thumbnails, waveforms, proxies or AI jobs run.

No expensive timeline operation should block the UI thread.

Create diagnostics showing:

Renderer:
Decoder:
Encoder:
GPU:
VRAM:
Hardware acceleration:
Playback resolution:
Dropped frames:

==================================================
PHASE 3: TURN THE TIMELINE INTO A REAL PRO NLE
==================================================

Extend the CURRENT timeline.

Implement REAL operations for:

- selection tool
- razor
- ripple delete
- ripple trim
- roll edit
- slip edit
- slide edit
- insert edit
- overwrite edit
- lift
- extract
- snapping
- linked selection
- unlink audio/video
- track targeting
- sync lock
- track lock
- mute
- solo
- markers
- clip labels
- adjustment layers
- nested sequences
- compound clips
- freeze frame
- reverse
- speed change
- time remapping

Add proper handles and direct manipulation.

Every edit must:

- modify actual project state
- support undo/redo
- serialize correctly
- restore after reopen
- affect exported output
- have automated tests

Add source monitor + program monitor workflow.

Support:

- In
- Out
- Insert
- Overwrite
- Match Frame
- Go to edit
- Previous/next edit
- frame stepping
- J/K/L playback

==================================================
PHASE 4: PROFESSIONAL KEYFRAMES + ANIMATION
==================================================

The current basic keyframe implementation is not enough.

Create a proper animation system.

Every animatable property should support:

- keyframe enable/disable
- add/remove keyframe
- previous/next keyframe
- copy/paste
- multi-select
- drag in time
- value editing

Interpolation:

- Hold
- Linear
- Ease In
- Ease Out
- Bezier
- Auto Bezier
- Continuous Bezier

Build a real GRAPH EDITOR.

Include:

- value graph
- speed graph
- editable Bezier handles
- zoom
- pan
- fit selection
- snapping

Properties:

- position
- scale
- rotation
- anchor
- opacity
- crop
- effects
- masks
- text parameters where applicable

==================================================
PHASE 5: REAL COMPOSITING / AFTER-EFFECTS-CLASS CORE
==================================================

Turn the Composite workspace into a real compositor.

Implement:

- compositions
- nested compositions/precomps
- 2D layers
- adjustment layers
- null/controller layers
- parenting
- track mattes
- alpha mattes
- luma mattes
- blend modes
- masks
- effect stacks
- motion blur
- layer timing
- layer in/out
- layer stretching
- time remapping

Each visual layer must support:

Position
Scale
Rotation
Anchor
Opacity

Create proper layer controls in the composition timeline.

Implement canvas manipulation:

- resize handles
- rotate
- move
- anchor-point editing
- guides
- snapping
- safe areas

==================================================
PHASE 6: MASK ENGINE
==================================================

Upgrade masks into professional editable Bezier masks.

Implement:

- arbitrary Bezier paths
- editable vertices
- tangent handles
- Add
- Subtract
- Intersect
- feather
- expansion
- opacity
- inversion
- multiple masks per layer
- mask keyframes
- mask path animation

Mask editing must happen directly in the viewer.

==================================================
PHASE 7: EFFECT ENGINE
==================================================

Create a real reusable GPU/CPU effect architecture.

Effect stack must support:

- add
- remove
- reorder
- bypass
- reset
- duplicate
- copy/paste
- presets
- animation

Initial real effects:

COLOR:
- Exposure
- Brightness/Contrast
- Levels
- Curves
- Hue/Saturation
- Temperature/Tint
- Vibrance
- LUT

BLUR:
- Gaussian Blur
- Directional Blur
- Radial Blur

DISTORT:
- Transform
- Lens Distortion
- Wave
- Displacement
- Perspective

STYLIZE:
- Glow
- Mosaic
- Posterize
- Grain
- Edge Detection

UTILITY:
- Crop
- Transform
- Timecode

Do not implement visual-only sliders.

Every parameter must alter rendered pixels.

==================================================
PHASE 8: BUILD THE REAL PHOTO WORKSPACE
==================================================

The Photo workspace should become a real Photoshop-class layered raster editor.

Create image documents independent of video sequences.

Implement:

LAYERS:
- pixel layers
- groups
- adjustment layers
- text layers
- vector/shape layers
- masks
- clipping
- opacity
- blend modes
- locking
- visibility

TOOLS:
- Move
- Rectangular Marquee
- Elliptical Marquee
- Lasso
- Polygon Lasso
- Quick Selection
- Magic Wand
- Crop
- Eyedropper
- Brush
- Pencil
- Eraser
- Gradient
- Paint Bucket
- Clone Stamp
- Healing
- Blur
- Sharpen
- Smudge
- Dodge
- Burn
- Pen
- Text
- Shapes
- Hand
- Zoom

Build actual raster operations.

Brush engine must include:

- size
- hardness
- opacity
- flow
- spacing
- pressure interface for future tablet support

Selections must support:

- Add
- Subtract
- Intersect
- Feather
- Grow
- Shrink
- Invert
- Transform

==================================================
PHASE 9: NONDESTRUCTIVE PHOTO ADJUSTMENTS
==================================================

Implement adjustment layers:

- Levels
- Curves
- Exposure
- Brightness/Contrast
- Hue/Saturation
- Vibrance
- Color Balance
- Black & White
- Gradient Map
- Selective Color
- LUT
- Shadows/Highlights
- Temperature/Tint

Create proper histograms.

Curves must support RGB + individual channels.

==================================================
PHASE 10: PROFESSIONAL COLOR WORKSPACE
==================================================

Turn Color into a real grading workspace.

Implement:

- exposure
- contrast
- pivot if useful
- highlights
- shadows
- whites
- blacks
- temperature
- tint
- saturation
- vibrance
- lift
- gamma
- gain
- offset

Curves:

- RGB
- Red
- Green
- Blue
- Hue vs Hue
- Hue vs Saturation
- Hue vs Luma
- Luma vs Saturation

Color wheels:

- Shadows
- Midtones
- Highlights

SCOPES:

- waveform
- RGB parade
- vectorscope
- histogram

Scopes must analyze actual rendered frames.

Explore OpenColorIO architecture.

Support:

- sRGB
- Rec.709
- Display P3 where possible
- LUT import
- .cube LUT
- HDR-ready internal architecture
- ACES-ready architecture

==================================================
PHASE 11: PROFESSIONAL AUDIO
==================================================

Turn Audio into an actual audio workstation.

Implement:

- sample-accurate waveform
- clip gain
- volume envelopes
- pan
- fades
- crossfades
- mute
- solo
- buses
- master bus
- audio meters

Effects:

- parametric EQ
- compressor
- limiter
- gate
- de-esser
- high-pass
- low-pass
- noise reduction
- reverb
- delay

Support automation/keyframes.

Audio processing must affect actual export.

==================================================
PHASE 12: TRANSITIONS
==================================================

Create a real transition engine.

Implement:

- Cross Dissolve
- Dip to Black
- Dip to White
- Wipe
- Push
- Slide
- Zoom
- Blur
- Directional Blur
- Luma transition

Transitions need:

- duration
- handles
- inspector settings
- easing
- timeline visualization
- render support
- export support

==================================================
PHASE 13: PROXIES + BACKGROUND JOB ENGINE
==================================================

Create a persistent background job system.

Jobs:

- proxies
- waveform generation
- thumbnails
- transcription
- tracking
- stabilization
- AI processing
- render/export

States:

Queued
Running
Paused
Completed
Failed
Canceled

Create Tasks panel.

Proxy system:

- generate
- attach
- detach
- toggle proxy/original
- resolution options
- codec options
- relink
- regenerate

==================================================
PHASE 14: RAW IMAGE PIPELINE
==================================================

Implement REAL RAW processing.

Investigate an appropriate library such as LibRaw.

Support practical camera RAW formats.

Nondestructive controls:

- exposure
- temperature
- tint
- contrast
- highlights
- shadows
- whites
- blacks
- texture
- clarity
- dehaze
- vibrance
- saturation
- HSL
- curves
- sharpening
- denoise
- chromatic aberration
- lens correction
- geometry
- crop

Never modify the original RAW.

==================================================
PHASE 15: AI FOUNDATION
==================================================

The AI Studio tab currently must NOT remain decorative.

Build a real AI runtime/provider architecture.

Create:

AIProvider

supporting:

LOCAL
REMOTE
CUSTOM

Potential local runtime:

- ONNX Runtime
- DirectML on Windows
- CUDA where available
- CPU fallback

Create Model Manager.

Show:

- model
- purpose
- provider
- size
- installed status
- download status
- execution device

Do not silently download huge models.

FIRST REAL AI FEATURES:

1. speech transcription
2. automatic captions
3. silence detection
4. filler-word detection
5. background segmentation
6. object segmentation

Prefer usable local models.

==================================================
PHASE 16: TEXT-BASED VIDEO EDITING
==================================================

This should become a flagship supp.edit feature.

Generate transcript from video/audio.

Transcript panel must support:

- word timestamps
- speaker identification where supported
- clicking text moves playhead
- selecting text selects timeline range
- deleting text can ripple-delete timeline media
- search transcript
- remove silences
- remove filler words
- create captions

Do not just display transcription.

It must be connected bidirectionally to timeline edits.

==================================================
PHASE 17: AI COMMAND SYSTEM
==================================================

Create a project-aware natural-language editing system.

Commands such as:

"Remove silences longer than 800 ms."
"Create captions."
"Make this sequence vertical."
"Remove this person's background."
"Blur faces."
"Normalize dialogue."
"Stabilize this shot."
"Create a 30-second highlight."

The AI must call REAL internal editor commands.

Never merely respond with text claiming a task was completed.

Every AI-generated edit should remain undoable.

==================================================
PHASE 18: TRACKING / ROTO / STABILIZATION
==================================================

Implement real:

- point tracking
- object tracking
- mask tracking
- planar tracking if feasible
- stabilization

Tracking data should be attachable to:

- position
- scale
- rotation
- masks
- text
- null/controller layers

Then implement AI-assisted rotoscoping:

- foreground selection
- frame propagation
- correction
- edge refine
- alpha matte
- mask output

==================================================
PHASE 19: 3D COMPOSITING FOUNDATION
==================================================

After the 2D compositor is mature, implement:

- 3D layer switch
- XYZ position
- XYZ rotation
- camera
- perspective
- lights
- depth
- depth of field
- shadows where feasible

Support initial:

- GLTF
- GLB

Do not attempt to reproduce Blender.

Focus on motion-graphics/compositing use cases.

==================================================
PHASE 20: PLUGIN ARCHITECTURE
==================================================

Design secure plugin interfaces for:

- effects
- transitions
- generators
- AI providers
- importers
- exporters
- panels

Build an SDK example.

Document it.

Do not allow unrestricted unsafe execution from plugins by default.

==================================================
PHASE 21: EXPORT ENGINE UPGRADE
==================================================

Extend current working export.

Build:

- Export Queue
- multiple jobs
- presets
- progress
- cancel
- retry
- logs
- hardware encoder selection

Support where available:

H.264
H.265
AV1
VP9
ProRes-compatible workflows where legally/technically permitted
image sequences
PNG
JPEG
TIFF
EXR
WAV
FLAC
AAC

Create presets:

YouTube
YouTube Shorts
Instagram Reels
TikTok
X
1080p
1440p
4K
high-quality master
transparent video where supported

==================================================
PHASE 22: MULTICAM
==================================================

Implement:

- multiple camera sources
- synchronize by audio
- synchronize by timecode
- manual sync
- multicam viewer
- live camera switching
- change selected angle afterward
- flatten multicam

==================================================
PHASE 23: EXPRESSIONS
==================================================

Build supp.edit's own safe expression engine.

Do NOT copy Adobe's proprietary implementation.

Expose things such as:

time
frame
fps
value
layer
composition

Functions:

sin
cos
random
noise
clamp
lerp
smoothstep
wiggle
loop
mapRange

Expressions must be sandboxed.

==================================================
PHASE 24: PROFESSIONAL UX
==================================================

Implement:

- fully resizable/dockable panels
- saved layouts
- floating panels where possible
- customizable shortcuts
- shortcut conflict detection
- command palette
- searchable effects
- searchable commands
- contextual menus
- drag/drop
- multi-monitor readiness
- UI scaling
- accessibility

==================================================
PHASE 25: STABILITY AND CROSS PLATFORM
==================================================

Harden Windows first.

Test:

- fresh installation
- missing media
- corrupted media
- huge video
- variable frame rate
- 4K
- long timelines
- missing codec
- low-memory conditions
- crash recovery
- export cancellation

Then verify:

macOS
Linux

Do not mark these supported until actually tested.

==================================================
STRICT ENGINEERING RULE
==================================================

For every feature:

UI
→ command
→ project state
→ processing
→ preview
→ undo
→ save
→ reload
→ export where relevant
→ automated test

If any stage is missing, the feature is not complete.

==================================================
DO NOT DO THIS
==================================================

Do not:

- stop after making more tabs
- create fake controls
- create static previews
- fake processing with timers
- fake AI completion
- fake exports
- hardcode output
- hide errors
- put TODO functionality behind functional-looking controls
- call a feature complete because the UI exists
- rewrite working features unnecessarily
- spend this cycle building a marketing site

==================================================
BUILD EXECUTION
==================================================

Work autonomously.

Continue modifying the actual repository.

Do not return only a plan.

Do not ask me to approve every phase.

Implement as much as possible in this session in the order above.

If context/time limits prevent completing everything:

1. finish the subsystem currently being worked on cleanly
2. make it compile
3. run tests
4. launch it
5. validate it
6. update CURRENT_STATE.md
7. update ROADMAP.md
8. clearly state EXACTLY what remains
9. leave no fake implementation pretending to be finished

For this session, PRIORITIZE:

1. GPU/media engine
2. professional timeline
3. advanced animation/keyframes
4. compositor
5. photo/layer engine
6. color/audio foundation

AI/3D/plugins come after those foundations unless parallel implementation is safe.

I want measurable functional advancement, not a larger interface.

Start by auditing and launching the current build, then immediately continue coding.