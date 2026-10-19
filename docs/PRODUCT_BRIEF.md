# SUPP.EDIT — BUILD THE ULTIMATE AI-NATIVE CREATIVE SUITE

You are the principal software architect, graphics engineer, video-engine engineer, AI engineer, product designer, security engineer, and senior full-stack developer responsible for building **supp.edit**.

Do not create a prototype, mockup, landing page, static UI, fake editor, or demo.

Build a genuinely functional, production-oriented creative application.

The ambition:

> Create the most powerful unified creative workstation possible with modern technology, combining professional nonlinear video editing, photo/image manipulation, compositing, motion graphics, VFX, audio post-production, vector/design capabilities, RAW processing, 3D-aware workflows, and generative AI inside one coherent application.

The product should offer functional equivalents to the major professional capabilities users expect from applications such as:

- Adobe Premiere Pro
- Adobe Photoshop
- Adobe After Effects
- Adobe Lightroom / Camera Raw
- Audition-style audio editing
- Media Encoder-style rendering

However:

DO NOT copy Adobe source code, proprietary assets, proprietary algorithms, trademarks, icons, splash screens, copyrighted artwork, or reproduce their UI pixel-for-pixel.

Build original supp.edit implementations and an original visual identity.

---

# 1. CORE PRODUCT PRINCIPLE

Current professional creative software is fragmented.

A user edits video in one application, sends a composition into another, opens images somewhere else, renders through another tool, and repeatedly duplicates assets.

supp.edit must eliminate this fragmentation.

Every project should live inside ONE creative environment.

A single project can contain:

- video timelines
- sequences
- compositions
- images
- PSD-like layered documents
- vector layers
- audio
- subtitles
- masks
- effects
- adjustment layers
- 3D layers
- motion graphics
- AI-generated assets
- proxies
- RAW images
- LUTs
- fonts
- project metadata
- reusable templates

Do not make separate disconnected mini-apps.

Create workspaces operating over the SAME underlying project graph.

Example workspaces:

EDIT
COMPOSITE
PHOTO
MOTION
COLOR
AUDIO
AI STUDIO
3D
EXPORT
ASSETS

A user should be able to double-click a clip in the timeline, open a frame in the image editor, modify it nondestructively, add animation in the compositor, return to the timeline, and see everything update automatically.

---

# 2. TARGET PLATFORM

PRIMARY:

Build supp.edit as a high-performance desktop application for:

- Windows
- macOS
- Linux

Preferred architecture:

Tauri 2
+
Rust backend
+
React
+
TypeScript

Do NOT make Electron the default unless an unavoidable technical blocker exists.

Desktop performance is critical.

OPTIONAL SECONDARY TARGET:

Create a web companion/editor using as much shared UI/business logic as possible.

The desktop application remains the professional version.

---

# 3. TECHNOLOGY ARCHITECTURE

Use a serious native/media architecture.

## UI

- React
- TypeScript
- Vite
- Tailwind where appropriate
- CSS variables/design tokens
- Zustand or an equally suitable high-performance state architecture
- TanStack Query where server state is required
- virtualized lists
- keyboard-first interactions
- detachable/resizable panels
- dockable workspaces

## Native Core

Rust.

Separate the application into logical Rust crates/modules such as:

core
project
timeline
media
decoder
renderer
compositor
image
color
audio
effects
gpu
export
cache
proxy
ai
plugins
storage
undo
automation

Avoid putting the entire backend into one giant file.

## GPU

Use GPU acceleration wherever practical.

Prefer:

- wgpu
- WebGPU concepts
- compute shaders
- fragment shaders
- hardware decoding/encoding when available

Support graceful CPU fallback.

## Media

Integrate FFmpeg where licensing permits.

Required media capabilities:

- demuxing
- decoding
- encoding
- waveform extraction
- thumbnails
- proxies
- transcoding
- audio conversion
- frame extraction
- metadata inspection
- hardware acceleration

Investigate platform acceleration:

Windows:
- NVENC
- NVDEC
- Intel Quick Sync
- AMD AMF
- DirectX related acceleration where useful

macOS:
- VideoToolbox
- Metal

Linux:
- VAAPI
- NVENC/NVDEC where available

Create capability detection.

Never assume every computer has the same codecs or GPU.

---

# 4. DESIGN LANGUAGE

Do NOT clone Adobe's interface.

Create an original high-end professional interface for supp.edit.

Visual direction:

- dark professional workstation
- extremely clean
- dense without becoming confusing
- subtle depth
- minimal visual noise
- crisp typography
- high information density
- customizable panels
- premium animations only where useful
- excellent hover/focus/selection states
- suitable for 8–12 hour professional sessions

Brand:

supp.edit

Use an original logo and icon language.

Create a design-token system for:

- surfaces
- panels
- borders
- text hierarchy
- selections
- warnings
- timeline tracks
- media types
- keyframes
- waveforms
- masks
- nodes

Allow:

- dark theme
- light theme
- customizable accent
- UI scaling
- high-DPI displays

---

# 5. WORKSPACE SYSTEM

Create fully dockable professional workspaces.

Panels must support:

- docking
- resizing
- tabbing
- floating
- collapsing
- saving layouts
- restoring layouts
- multiple monitors where desktop APIs permit

Default workspaces:

### EDIT

For nonlinear video editing.

### COMPOSITE

For VFX and compositing.

### PHOTO

For layered raster/image editing.

### MOTION

For motion graphics and animation.

### COLOR

For professional grading.

### AUDIO

For sound editing and mixing.

### AI STUDIO

For AI-based creative operations.

### 3D

For cameras, lights, scenes, 3D layers and integrations.

### EXPORT

For render management.

---

# 6. PROFESSIONAL VIDEO EDITOR

Build a serious NLE.

Timeline functionality must include:

- unlimited video tracks
- unlimited audio tracks
- nested sequences
- compound clips
- linked/unlinked audio
- insert editing
- overwrite editing
- ripple editing
- roll editing
- slip
- slide
- razor
- trim
- ripple trim
- track targeting
- snapping
- markers
- clip labels
- track locking
- visibility toggles
- audio mute
- audio solo
- sync locking
- transitions
- adjustment layers
- speed changes
- freeze frame
- reverse
- time remapping
- frame holds
- multicam
- proxies
- offline media relinking
- source monitor
- program monitor
- in/out ranges
- J/K/L playback
- keyboard editing
- frame stepping
- history
- autosave

Do not make the timeline merely visual.

Timeline operations must genuinely modify project state and affect playback/rendering.

---

# 7. TIMELINE PERFORMANCE ARCHITECTURE

The timeline must remain smooth on large projects.

Implement:

- virtualized rendering
- thumbnail cache
- waveform cache
- proxy workflow
- background indexing
- frame caching
- intelligent prefetch
- async decoding
- worker pools
- cancellation tokens
- priority queues

Playback must take priority over low-priority background operations.

Avoid React rerendering every clip on every playhead movement.

Use appropriate native/GPU/rendering techniques.

---

# 8. PROFESSIONAL PLAYBACK ENGINE

Create:

- source monitor
- program monitor
- fullscreen monitor
- comparison viewer
- scopes viewer

Playback controls:

- play/pause
- shuttle
- JKL
- next/previous frame
- next/previous edit
- playback resolution
- loop
- safe margins
- guides
- overlays
- alpha view
- comparison view

Support:

24
25
29.97
30
50
59.94
60
120 FPS

and variable frame-rate media.

Support accurate timestamp management.

---

# 9. MEDIA BIN / ASSET MANAGEMENT

Create a powerful media browser.

Functions:

- folders/bins
- list view
- icon view
- metadata columns
- thumbnails
- hover scrubbing
- search
- filters
- tags
- favorites
- ratings
- labels
- smart collections
- metadata editing
- duplicate detection
- unused media detection

Media ingestion:

- drag/drop
- file browser
- folder import
- camera media
- image sequence
- audio
- video
- RAW
- LUT
- fonts where appropriate

Generate metadata automatically.

---

# 10. MULTICAM

Implement multicamera editing.

Features:

- synchronize by timecode
- synchronize by audio waveform
- synchronize manually
- multiple camera angles
- live angle switching during playback
- audio follows video option
- dedicated multicam viewer
- flatten multicam sequence
- change angle after edit

---

# 11. TRANSITIONS

Create a transition engine.

Start with:

- cross dissolve
- dip to black
- dip to white
- film dissolve
- wipes
- pushes
- slides
- zoom
- blur
- directional blur
- morph-style transition
- luma transition

Transitions must support:

- adjustable duration
- easing
- parameter controls
- GPU rendering

Allow third-party transitions later.

---

# 12. EFFECT STACK

Every layer/clip should support a nondestructive effect stack.

Effects can:

- be reordered
- bypassed
- reset
- duplicated
- copied
- pasted
- animated
- saved as presets

Every animatable parameter should expose:

- stopwatch/keyframe toggle
- previous keyframe
- next keyframe
- add/remove keyframe

---

# 13. MOTION / TRANSFORM CONTROLS

Every visual clip/layer supports:

- position
- anchor point
- scale
- rotation
- opacity
- skew
- crop
- perspective where applicable
- blend mode
- motion blur

Allow on-canvas transformation handles.

---

# 14. KEYFRAME SYSTEM

Build a professional animation engine.

Support interpolation:

- linear
- hold
- Bezier
- auto Bezier
- continuous Bezier
- ease in
- ease out
- custom curves

Create:

- value graph
- speed graph
- graph editor
- keyframe snapping
- keyframe copy/paste
- multi-property editing

---

# 15. EXPRESSIONS

Create a scripting/expression system for animation.

Do NOT copy proprietary Adobe implementation.

Develop supp.edit's own safe expression environment.

Possible approach:

JavaScript-like sandbox or purpose-built expression syntax.

Expose variables such as:

time
frame
fps
layer
comp
property
value

Provide helpers:

sin
cos
noise
random
clamp
lerp
smoothstep
wiggle
loop
mapRange

Example creative expression:

wiggle(2, 30)

Expressions must run safely and must not permit arbitrary filesystem/network access.

---

# 16. COMPOSITING ENGINE

Create professional layer compositing.

Support:

- unlimited layers
- precompositions
- nested compositions
- adjustment layers
- track mattes
- alpha mattes
- luma mattes
- masks
- blend modes
- 2D layers
- 3D layers
- null/controller layers
- cameras
- lights
- parenting
- motion blur
- depth of field
- guides

---

# 17. MASK ENGINE

Create masks supporting:

- Bezier points
- add/subtract/intersect
- feather
- expansion
- opacity
- inversion
- mask animation
- mask tracking
- multiple masks

Canvas editing must support intuitive direct manipulation.

---

# 18. ROTOSCOPING

Build AI-assisted rotoscoping.

User flow:

1. Paint/select foreground object.
2. AI segments subject.
3. Track segmentation across frames.
4. User corrects difficult frames.
5. Corrections propagate.
6. Refine edges.
7. Adjust feather/decontamination.
8. Export/use resulting alpha matte.

Architect model providers abstractly.

Allow local models where practical.

Never make the UI pretend processing succeeded if no model is available.

Show actual progress/error states.

---

# 19. MOTION TRACKING

Support:

- point tracking
- planar tracking
- object tracking
- face tracking
- camera tracking when technically practical

Tracking data should be applicable to:

- position
- rotation
- scale
- masks
- null/controller layer
- text
- graphics
- stabilization

---

# 20. STABILIZATION

Implement video stabilization.

Options:

- smooth motion
- no motion
- crop strategy
- auto-scale
- smoothness
- translation-only
- translation/rotation
- perspective where supported

Display analysis progress.

Allow cancellation.

---

# 21. CHROMA KEY

Build professional green/blue-screen keying.

Controls:

- color picker
- tolerance
- spill suppression
- edge softness
- transparency
- edge cleanup
- matte preview
- garbage masks
- holdout masks
- despill
- color correction

---

# 22. BLEND MODES

Support standard professional blend modes:

Normal
Dissolve if practical
Darken
Multiply
Color Burn
Linear Burn
Lighten
Screen
Color Dodge
Linear Dodge/Add
Overlay
Soft Light
Hard Light
Difference
Exclusion
Hue
Saturation
Color
Luminosity

Use correct linear/gamma treatment.

---

# 23. PHOTO / IMAGE EDITOR

Create a full nondestructive layered image editor.

Core:

- image documents
- layers
- groups
- masks
- clipping
- adjustment layers
- smart/nondestructive objects or equivalent
- guides
- rulers
- snapping
- artboards
- history
- selections
- channels where useful
- paths

Tools:

Move
Marquee
Lasso
Polygon lasso
Magnetic selection
AI object selection
Quick selection
Magic wand
Crop
Perspective crop
Eyedropper
Brush
Pencil
Eraser
Gradient
Paint bucket
Clone stamp
Healing brush
Spot healing
Patch
Blur
Sharpen
Smudge
Dodge
Burn
Sponge
Pen
Text
Shape
Hand
Zoom

Each tool needs actual functionality.

---

# 24. SELECTION ENGINE

Support:

- rectangular
- elliptical
- lasso
- polygon
- color-range
- luminance-range
- object
- subject
- sky
- foreground/background
- AI segmentation

Selection operations:

- add
- subtract
- intersect
- feather
- grow
- shrink
- smooth
- invert
- transform

---

# 25. LAYER SYSTEM

Create layer types:

- pixel
- vector
- text
- adjustment
- image
- video
- smart/reference layer
- group
- shape
- generator
- AI-generated layer

Layer functions:

- lock
- visibility
- opacity
- masks
- blend modes
- clipping
- transform
- filter stack
- duplicate
- merge
- flatten

Keep editing nondestructive wherever possible.

---

# 26. ADJUSTMENT LAYERS

Implement:

- brightness/contrast
- levels
- curves
- exposure
- vibrance
- hue/saturation
- color balance
- black & white
- photo filter
- channel mixer
- gradient map
- selective color
- LUT
- shadows/highlights
- temperature/tint

---

# 27. CURVES

Build professional curves.

Channels:

- RGB
- red
- green
- blue
- luminance where useful

Features:

- draggable points
- histogram
- reset
- presets
- eyedropper targeting where practical

---

# 28. RAW PHOTO DEVELOPMENT

Create nondestructive RAW development.

Investigate LibRaw or another suitable open-source RAW solution.

Controls:

- exposure
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
- temperature
- tint
- tone curve
- HSL
- sharpening
- denoise
- lens corrections
- chromatic aberration
- geometry
- crop
- vignette

Store edits as metadata rather than modifying source media.

---

# 29. CONTENT-AWARE / INTELLIGENT RETOUCHING

Implement AI-assisted:

- object removal
- background removal
- background replacement
- generative fill
- generative expand
- smart healing
- distraction removal
- sky replacement
- face-aware selections

Provider architecture must support:

LOCAL
REMOTE API
CUSTOM PROVIDER

Never hardcode an expensive proprietary service into core architecture.

---

# 30. GENERATIVE FILL

Workflow:

1. User makes selection.
2. Enter optional prompt.
3. Choose generation method/provider.
4. Generate alternatives.
5. Store each result nondestructively.
6. Allow regeneration.
7. Allow mask refinement.
8. Preserve original image.

---

# 31. MOTION GRAPHICS

Create:

- animated text
- titles
- lower thirds
- shapes
- SVG support
- gradients
- strokes
- repeaters
- trim paths
- paths
- text animators
- character animation
- per-word animation
- per-line animation
- text-on-path
- reusable templates

Allow users to create motion templates that expose selected parameters.

---

# 32. TEXT ENGINE

Professional typography:

- font browser
- family/style
- size
- kerning
- tracking
- leading
- baseline
- alignment
- paragraph settings
- stroke
- fill
- shadows
- gradients
- text boxes
- vertical/horizontal text
- variable fonts if supported

Support font search and favorites.

---

# 33. SHAPE ENGINE

Create editable:

- rectangles
- rounded rectangles
- ellipse
- polygon
- stars
- lines
- arbitrary paths

Properties:

- fill
- stroke
- gradient
- dash
- cap
- join
- path operations
- transform
- repeater
- trim paths

---

# 34. PEN TOOL

Professional Bezier pen tool.

Features:

- anchor creation
- tangent handles
- delete anchor
- convert anchor
- path closing
- path continuation
- snapping
- path editing

---

# 35. COLOR GRADING

Create a professional grading workspace.

Controls:

- exposure
- contrast
- highlights
- shadows
- whites
- blacks
- temperature
- tint
- saturation
- curves
- RGB curves
- hue-vs-hue
- hue-vs-saturation
- hue-vs-luma
- luma-vs-saturation
- color wheels
- shadows
- midtones
- highlights
- lift
- gamma
- gain
- offset

Support multiple grading nodes/layers or ordered correction stages.

---

# 36. COLOR MANAGEMENT

Investigate integrating OpenColorIO.

Support:

- Rec.709
- sRGB
- Display P3
- HDR workflows
- PQ
- HLG
- ACES workflows where viable
- camera log transforms
- LUTs

Support LUT import:

.cube and common formats where practical.

---

# 37. SCOPES

Create GPU-accelerated scopes:

- waveform
- RGB parade
- vectorscope
- histogram

Allow:

- scaling
- brightness
- overlays
- skin-tone line where appropriate

---

# 38. HDR

Architect proper HDR workflows:

- high bit depth processing
- HDR preview where OS/display permits
- PQ
- HLG
- HDR metadata where supported
- SDR tone mapping

---

# 39. AUDIO WORKSPACE

Build professional audio tools.

Features:

- waveforms
- volume
- pan
- mute
- solo
- clip gain
- fades
- crossfades
- keyframes
- buses
- master bus
- effects
- track mixer
- automation

Effects:

- EQ
- compressor
- limiter
- gate
- expander
- de-esser
- noise reduction
- high-pass
- low-pass
- reverb
- delay
- pitch shift
- normalization

---

# 40. AI VOICE ENHANCEMENT

Create a speech enhancement workflow:

- noise removal
- hum removal
- dereverb
- speech isolation
- loudness normalization
- silence detection

Allow local-model implementations when practical.

---

# 41. TEXT-BASED VIDEO EDITING

This is a flagship supp.edit feature.

When media contains speech:

1. Generate transcript.
2. Show transcript beside timeline.
3. Clicking text jumps playhead.
4. Selecting text selects corresponding timeline range.
5. Deleting text optionally performs ripple edit.
6. Search spoken phrases.
7. Identify speakers.
8. Generate captions.
9. Remove filler words.
10. Detect long pauses.

Architect speech-to-text provider abstraction.

Potential implementations:

- Whisper
- whisper.cpp
- local speech models
- external APIs

Favor privacy-friendly local inference where hardware allows.

---

# 42. CAPTIONS / SUBTITLES

Support:

- automatic transcription
- SRT import/export
- VTT
- editable captions
- speaker labels
- caption styling
- burn-in
- sidecar export
- word timing
- line timing

AI:

- translation
- summarization
- subtitle correction
- punctuation
- reformatting

---

# 43. AI STUDIO

AI must be deeply integrated instead of being a decorative chatbot.

Create a central AI Studio.

Functions can include:

### Video

- silence remover
- filler-word remover
- transcript editing
- auto reframing
- scene detection
- highlight detection
- short-form generation
- jump-cut creation
- multicam suggestions
- caption generation
- B-roll suggestions
- title suggestions
- beat detection
- smart crop
- stabilization assistance

### Image

- background removal
- segmentation
- object removal
- generative fill
- upscale
- denoise
- face restoration
- relighting
- recolor
- depth estimation
- sky selection

### Audio

- transcription
- speech cleanup
- noise removal
- silence detection
- speaker separation where available

### Organization

- semantic media search
- automatic tagging
- face grouping where privacy-compatible
- transcript search
- scene descriptions

---

# 44. AI COMMAND BAR

Create a natural-language command interface.

Example commands:

"Remove all silences longer than 800 ms."

"Create captions in English."

"Make vertical clips from the three most engaging sections."

"Remove the background from this subject."

"Track this text to the moving car."

"Make this image warmer."

"Blur every visible license plate."

"Create a cinematic grade but preserve skin tones."

"Stabilize this clip."

"Turn this landscape sequence into a 9:16 Reel."

IMPORTANT:

AI commands must map to real internal application operations.

Do not fake completion through chat responses.

Before destructive actions:

show an operation preview or provide undo.

---

# 45. SEMANTIC SEARCH

Allow users to search project media semantically.

Example:

"man walking near mountains"

"clip where speaker mentions pricing"

"sunset drone footage"

"shot containing red car"

Search across:

- transcripts
- generated descriptions
- filenames
- metadata
- tags

Build embeddings/indexing as an optional local or provider-based service.

---

# 46. AUTO REFRESH / NONDESTRUCTIVE LINKING

If an image, nested composition, proxy, audio file, or linked asset changes:

detect it.

Provide:

- auto refresh
- notification
- manual reload

Internal project dependencies should update automatically.

---

# 47. 3D WORKSPACE

Create foundational 3D compositing support.

Features:

- 3D layer transforms
- XYZ position
- XYZ rotation
- scale
- cameras
- lights
- depth
- perspective
- shadows where applicable
- depth of field
- basic 3D models

Explore:

- glTF
- GLB
- OBJ

Do not attempt to rebuild Blender completely.

Focus on 3D elements useful for motion design and compositing.

---

# 48. PARTICLES

Create an extensible particle engine.

Parameters:

- emitter type
- position
- velocity
- gravity
- turbulence
- lifetime
- size
- opacity
- rotation
- sprites
- trails

GPU accelerate.

---

# 49. EFFECT LIBRARY

Include broad categories.

### Blur

- Gaussian
- directional
- radial
- lens-style
- box
- motion

### Distort

- warp
- ripple
- wave
- bulge
- pinch
- displacement
- lens distortion
- perspective

### Stylize

- glow
- posterize
- emboss
- mosaic
- edge detection
- halftone
- grain

### Noise

- grain
- denoise
- noise generation
- dust/scratch simulation

### Color

- levels
- curves
- channel mixer
- hue/saturation
- tint
- exposure
- LUT

### Utility

- crop
- transform
- timecode
- safe margins

Effects should be real GPU/CPU processors.

---

# 50. PLUGIN SYSTEM

supp.edit should eventually have an ecosystem.

Design plugin APIs for:

- video effects
- image filters
- generators
- importers
- exporters
- AI providers
- workflow extensions
- panels

Security requirements:

- permissions
- sandboxing where practical
- clear trust indicators
- version compatibility

Create SDK documentation.

---

# 51. UNDO / REDO

Build a reliable command/history architecture from the beginning.

Every editing operation should preferably be represented as a reversible command.

Features:

- unlimited practical undo
- redo
- history panel
- named actions
- grouping

Avoid storing giant media buffers for each undo state.

Use efficient structural operations/diffs.

---

# 52. PROJECT FORMAT

Create an open documented supp.edit project format.

Suggested extension:

.supp

or

.suppedit

A project must reference original media rather than embedding everything unless intentionally packaged.

Store:

- project graph
- timeline
- compositions
- transforms
- effects
- animation
- media references
- AI operation history
- workspace preferences
- color settings

Use a versioned schema.

Support migrations.

Never make project files fragile JSON dumps without version control strategy.

---

# 53. AUTOSAVE / RECOVERY

Implement:

- periodic autosave
- crash recovery
- version history
- backup rotation

After abnormal shutdown:

offer latest recovery snapshot.

---

# 54. PROXIES

Create professional proxy workflows.

User can:

- generate proxies
- choose proxy resolution
- choose codec
- attach external proxies
- toggle original/proxy
- relink proxies
- regenerate proxies

Proxy generation runs in background.

---

# 55. BACKGROUND JOB SYSTEM

Create persistent background jobs for:

- proxies
- renders
- transcription
- waveform generation
- thumbnails
- AI analysis
- tracking
- stabilization
- conforming

UI:

Tasks panel showing:

- queued
- running
- paused
- completed
- failed
- canceled

Allow cancellation.

Never freeze UI for long processing tasks.

---

# 56. EXPORT

Create professional export functionality.

Containers:

- MP4
- MOV
- MKV
- WebM
- WAV
- MP3 where licensing/codec support allows
- image sequences

Video:

- H.264
- H.265/HEVC where available
- ProRes where legally/technically supported
- AV1
- VP9
- DNx-type workflows where appropriate
- uncompressed/image sequence

Image:

- PNG
- JPEG
- WebP
- TIFF
- EXR where supported

Audio:

- WAV
- AAC
- FLAC
- MP3 where permitted

Advanced options:

- resolution
- FPS
- bitrate
- constant/variable bitrate
- codec profile
- pixel format
- audio sample rate
- audio bitrate
- metadata
- render quality

---

# 57. EXPORT QUEUE

Create integrated render queue.

Features:

- multiple outputs
- presets
- pause
- cancel
- retry
- output location
- progress
- ETA when reliable
- elapsed time
- render logs

Users can continue editing when architecture permits.

---

# 58. EXPORT PRESETS

Provide presets for:

- YouTube
- YouTube Shorts
- Instagram Reels
- Instagram feed
- TikTok
- X
- Facebook
- 1080p
- 1440p
- 4K
- 8K where hardware supports
- archival
- transparent video where codec supports alpha

Do not assume platform specifications forever.

Keep presets data-driven and editable.

---

# 59. HARDWARE DETECTION

At application startup detect:

- CPU
- cores
- RAM
- GPU
- VRAM where possible
- hardware encoders
- hardware decoders
- available storage
- display properties

Use these to choose sensible defaults.

Never upload hardware data without explicit consent.

---

# 60. MEMORY MANAGEMENT

Large projects must not exhaust system RAM.

Implement:

- bounded caches
- LRU frame cache
- thumbnail cache
- waveform cache
- memory pressure response
- background cache cleanup
- disk cache
- configurable cache sizes

---

# 61. PERFORMANCE MODE

Create settings for:

AUTO
PERFORMANCE
QUALITY
BATTERY SAVER

Control:

- playback resolution
- prefetch
- GPU intensity
- background jobs
- proxy preference
- scope refresh rate

---

# 62. SHORTCUT SYSTEM

Professional editors rely on keyboard shortcuts.

Every important command must have:

- command ID
- default shortcut
- customizable shortcut

Create shortcut editor:

- search
- conflict detection
- import/export mappings
- reset

Allow presets inspired by common editing paradigms WITHOUT copying proprietary configuration files.

---

# 63. COMMAND PALETTE

Add a universal command palette.

Shortcut example:

Ctrl/Cmd + K

Search:

- tools
- panels
- commands
- effects
- settings
- assets
- AI actions

---

# 64. ACCESSIBILITY

Support:

- keyboard navigation
- ARIA
- scalable UI
- high-contrast mode
- colorblind-friendly indicators
- screen-reader accessible settings/forms
- captions
- configurable motion reduction

---

# 65. CLOUD OPTIONALITY

supp.edit must work offline for core editing.

Cloud features should be optional.

Potential cloud functionality:

- project sync
- asset storage
- review links
- team comments
- collaborative projects
- AI compute
- render farm

Never make basic local editing depend on an internet connection.

---

# 66. COLLABORATION

Design future-compatible collaboration architecture.

Potential capabilities:

- shared projects
- comments
- frame-specific comments
- review links
- approvals
- versions
- roles
- change history

Do not compromise local project reliability for premature real-time collaboration.

---

# 67. PRIVACY

Creative media is sensitive.

Privacy principles:

- local processing by default where possible
- clear warning before media leaves device
- explicit AI provider selection
- clear cloud upload status
- no hidden training opt-in
- secure token storage
- no API keys inside frontend source

---

# 68. SECURITY

Implement:

- secure IPC between frontend and Rust
- strict file permissions
- path validation
- safe plugin boundaries
- CSP
- API key protection
- signed update architecture
- dependency auditing
- input validation
- sandbox AI/expression execution

Never expose shell execution directly to renderer/UI code.

---

# 69. USER ACCOUNTS

The application should work locally without requiring an account unless server-dependent functionality requires one.

For optional account/cloud services:

- email/password
- OAuth
- session management
- secure reset
- email verification
- device/session management

Do not build fake authentication.

If backend credentials are not yet configured, create a proper configuration flow and clearly indicate setup requirements.

---

# 70. SETTINGS

Build complete preferences.

Categories:

GENERAL
APPEARANCE
MEDIA
CACHE
PLAYBACK
GPU
AUDIO
COLOR
AUTOSAVE
SHORTCUTS
AI
PLUGINS
EXPORT
PRIVACY
CLOUD
UPDATES

---

# 71. ONBOARDING

First launch:

- detect hardware
- configure cache
- choose keyboard preset
- optionally configure AI
- optionally sign in
- show concise interactive tour

Allow skipping everything.

Professionals should reach their workspace quickly.

---

# 72. HOME SCREEN

Provide:

- New Project
- Open Project
- Recent Projects
- Templates
- Recover Project
- Learn
- Preferences

New Project asks:

- name
- location
- resolution
- frame rate
- color space
- cache location

Allow automatic settings from first imported clip.

---

# 73. FILE IMPORT

Support drag/drop anywhere sensible.

Handle:

- missing codecs
- unsupported files
- corrupted media
- duplicate imports
- variable framerate
- large image sequences
- offline media

Errors must be descriptive.

Never silently fail.

---

# 74. RELINK MEDIA

If source files move:

show missing media manager.

Features:

- locate one
- locate all
- automatic folder search
- path substitution
- relink
- offline placeholder

---

# 75. PROJECT PACKAGING

Create "Collect Project" / "Package Project".

Options:

- project file
- used media only
- all media
- proxies
- fonts where legally redistributable
- LUTs
- templates
- dependencies

Warn about assets that cannot legally be redistributed.

---

# 76. TEMPLATE SYSTEM

Support templates for:

- video projects
- compositions
- titles
- lower thirds
- motion graphics
- transitions
- color presets
- export presets
- image documents

Users can save and share templates.

---

# 77. PRESET SYSTEM

Every major configurable tool should support presets.

Examples:

- effects
- transitions
- text
- animation
- export
- color
- audio
- AI workflows

Store presets in portable format.

---

# 78. PROJECT SEARCH

Universal project search should search:

- media
- sequences
- compositions
- effects
- transcripts
- markers
- captions
- comments
- metadata

---

# 79. VERSIONING

Create automatic project snapshots.

Example:

Project
v001
v002
v003

Users can:

- name versions
- restore
- duplicate
- compare metadata

---

# 80. PROFESSIONAL QUALITY REQUIREMENTS

Do NOT:

- fill the interface with buttons that do nothing
- fake progress
- hardcode demo output
- use static placeholder timelines
- pretend exports succeeded
- fake AI responses
- silently swallow errors
- store secrets in the frontend
- put every component in App.tsx
- create massive unmaintainable files
- use random state everywhere
- rebuild entire timelines on each playhead frame
- block UI during decoding
- silently overwrite project files

Every visible feature must either:

A. work

or

B. be clearly marked unavailable/experimental.

Never pretend.

---

# 81. TESTING

Set up:

Rust unit tests
TypeScript unit tests
component tests
integration tests
project serialization tests
timeline operation tests
render regression tests
export tests
crash recovery tests

Critical project operations need especially strong tests.

Test:

- open/save
- timeline edits
- undo/redo
- relinking
- nested compositions
- effects
- keyframes
- export
- proxies

---

# 82. LOGGING

Create professional diagnostics.

Logs:

- application
- media decoder
- GPU
- export
- AI
- crash

Add:

Help > Diagnostics

Users should be able to create a diagnostic bundle with privacy review before sharing.

---

# 83. CRASH HANDLING

Unexpected failure should:

1. preserve recovery data if possible
2. avoid corrupting the original project
3. log error
4. allow user to restart/recover
5. provide diagnostic information

Use atomic project save strategy.

---

# 84. UPDATE SYSTEM

Design auto-updates securely.

Support:

- stable
- beta
- nightly/developer

Verify signed updates.

Never execute arbitrary unsigned downloaded binaries.

---

# 85. LOCAL AI ARCHITECTURE

Create a modular model runtime.

Potential engines:

- ONNX Runtime
- CUDA
- DirectML
- Core ML
- Metal
- WebGPU
- CPU fallback

Model manager should show:

- model name
- purpose
- size
- provider
- download progress
- installed version
- device
- delete/update

Do not automatically download multi-gigabyte models without consent.

---

# 86. AI PROVIDER SYSTEM

Design:

AIProvider interface.

Providers may include:

- Local
- OpenAI-compatible endpoint
- custom REST provider
- other supported services

Store credentials in OS secure storage.

Users should be able to bring their own API key.

---

# 87. AI AGENT FOR EDITING

Create a project-aware assistant called something original to supp.edit.

It should understand:

- timeline structure
- selected clips
- transcript
- media metadata
- active composition
- current tool
- undo history

The AI agent may propose multi-step operations.

Example:

"Turn this 20-minute podcast into a 60-second Reel with captions."

Agent plan:

1. transcribe
2. analyze interesting moments
3. propose candidate clips
4. create vertical sequence
5. reframe speaker
6. remove pauses
7. add captions
8. normalize speech
9. allow review
10. export

Require confirmation for broad destructive changes unless fully reversible.

---

# 88. AI OPERATION GRAPH

Do not make AI a collection of isolated API calls.

Represent AI operations as reusable project operations.

Example:

TranscriptionNode
SegmentationNode
TrackingNode
GenerateImageNode
UpscaleNode
DenoiseNode
SceneAnalysisNode

Cache results.

If project has not changed, avoid recomputing expensive AI analysis.

---

# 89. SMART AUTOMATION

Add optional one-click workflows:

Podcast Cleanup
Reel Generator
YouTube Edit
Talking Head Cleanup
Background Removal
Product Photo Cleanup
Interview Multicam
Automatic Captions
Audio Cleanup
Social Reframe
Highlight Reel

These must orchestrate existing real tools, not fake them.

---

# 90. OPEN ARCHITECTURE

The long-term goal is for supp.edit to become an operating system for creative media.

Design APIs now so capabilities can expand later without rewriting everything.

Keep boundaries clear between:

UI
project model
render graph
media decoding
GPU effects
AI services
storage
plugins
cloud

---

# 91. SOURCE TREE

Use a professional monorepo.

Example direction:

/apps
  /desktop
  /web

/packages
  /ui
  /editor-state
  /project-schema
  /commands
  /timeline-ui
  /compositor-ui
  /image-ui
  /shared

/src-tauri or /native
  /crates
    /supp-core
    /supp-project
    /supp-media
    /supp-timeline
    /supp-render
    /supp-effects
    /supp-image
    /supp-audio
    /supp-color
    /supp-ai
    /supp-export
    /supp-plugin

/docs

/assets

/tests

Choose final structure based on engineering quality rather than blindly following this example.

---

# 92. CODE QUALITY

Use:

- strong TypeScript types
- strong Rust types
- no unnecessary `any`
- error enums
- clear interfaces
- reusable components
- comments for complex algorithms
- linting
- formatting
- structured commits if environment supports it

Avoid premature abstraction but never build spaghetti architecture.

---

# 93. BUILD STRATEGY

This project is enormous.

Do NOT respond by saying it is too ambitious.

Do NOT reduce it into a toy project.

Instead create a production architecture capable of expanding toward the full vision.

Implement in vertical slices.

A vertical slice must go:

UI
→ state
→ project model
→ processing
→ preview
→ serialization
→ undo
→ testing

For example, when implementing Transform:

do not only create sliders.

Make:

Position slider
→ project property
→ preview render
→ timeline keyframe support
→ project save
→ project reopen
→ undo/redo
→ tests

That is the standard for every subsystem.

---

# 94. IMPLEMENTATION ORDER

Start immediately.

Recommended sequence:

PHASE 0
Architecture, repository, build system, Tauri shell, Rust crates, design system.

PHASE 1
Project system, save/load, media importing, asset browser, source viewer.

PHASE 2
Functional timeline, playback, video/audio decoding, basic cutting.

PHASE 3
Transform/effect pipeline, keyframes, compositing.

PHASE 4
Export pipeline.

PHASE 5
Layered image editor.

PHASE 6
Masks, selections, painting, image adjustments.

PHASE 7
Advanced color grading and scopes.

PHASE 8
Audio workstation.

PHASE 9
Motion graphics/compositing.

PHASE 10
Transcription and text-based editing.

PHASE 11
Local/remote AI provider architecture.

PHASE 12
AI segmentation, object removal, smart workflows.

PHASE 13
Tracking, stabilization, roto.

PHASE 14
3D/motion expansion.

PHASE 15
Plugins, collaboration and ecosystem.

However, the repository and architecture must account for the whole product FROM THE START.

---

# 95. FIRST WORKING RELEASE TARGET

Before adding hundreds of shallow tools, ensure the application can actually perform this workflow:

1. Launch supp.edit.
2. Create project.
3. Import MP4 video, image and WAV audio.
4. Preview media.
5. Drag video onto timeline.
6. Scrub smoothly.
7. Cut clip.
8. Trim clip.
9. Move clip.
10. Add second video layer.
11. Add text.
12. Change text appearance.
13. Animate position with keyframes.
14. Add Gaussian blur.
15. Add mask.
16. Adjust video color.
17. Adjust audio volume.
18. Undo/redo.
19. Save.
20. Close.
21. Reopen.
22. Project reconstructs correctly.
23. Export final MP4.
24. Exported file genuinely contains edits.

Only count this milestone complete when the exported video is genuinely produced.

---

# 96. IMAGE EDITOR RELEASE TARGET

Image workflow must genuinely support:

1. Open image.
2. Add layer.
3. Paint.
4. Make selection.
5. Create mask.
6. Add text.
7. Move/scale/rotate.
8. Change blend mode.
9. Add curves adjustment.
10. Clone/heal.
11. Undo.
12. Save project.
13. Reopen.
14. Export PNG/JPEG.

---

# 97. AI RELEASE TARGET

The first AI implementation should preferably deliver real functionality such as:

- local transcription
- captions
- silence detection
- background segmentation

before attempting flashy generative tools.

Build an AI foundation that actually works.

---

# 98. PERFORMANCE TARGET

Optimize toward smooth professional usage.

Goals where hardware allows:

- responsive UI during playback
- low-latency timeline interaction
- hardware decode
- GPU effects
- background generation of thumbnails/waveforms
- proxy editing for difficult codecs
- graceful handling of 4K media
- eventual 8K workflows using proxies

Use profiling instead of guessing.

---

# 99. UX RULE

A professional feature should not require five clicks when one meaningful interaction can achieve it.

Add:

- contextual menus
- right-click operations
- drag/drop
- keyboard shortcuts
- searchable commands
- direct canvas manipulation

Every major operation should be discoverable through both GUI and command infrastructure.

---

# 100. DO NOT STOP AT THE DASHBOARD

This is extremely important.

Previous AI-generated applications often create:

- beautiful homepage
- sidebar
- timeline-looking rectangle
- fake upload
- fake buttons

and then stop.

YOU MUST NOT DO THAT.

The HOME SCREEN IS NOT THE PRODUCT.

The EDITING ENGINE IS THE PRODUCT.

Prioritize functional editing systems over marketing pages.

If time/resources are constrained, build fewer features deeply rather than hundreds of fake controls.

---

# 101. NO FAKE IMPLEMENTATIONS

Never write things like:

setTimeout(() => {
  setExportComplete(true)
}, 2000)

to simulate processing.

Never simulate:

- exports
- AI processing
- rendering
- transcription
- proxy generation
- saving
- synchronization

If the implementation is unfinished, expose the real unfinished state.

---

# 102. DOCUMENTATION

Maintain:

README.md
ARCHITECTURE.md
ROADMAP.md
PROJECT_FORMAT.md
RENDER_ENGINE.md
AI_ARCHITECTURE.md
PLUGIN_API.md
BUILDING.md
CONTRIBUTING.md

README must contain exact setup commands.

Keep documentation synchronized with the code.

---

# 103. DEVELOPMENT EXPERIENCE

One-command developer startup where possible.

Example:

pnpm install
pnpm dev

Native dependencies should be documented.

Include environment validation.

If FFmpeg or another external binary is required, automate setup where licensing/distribution permits or provide a clear setup command.

---

# 104. LICENSING

Audit all dependencies.

Do not blindly add software whose license conflicts with the intended product.

Document significant third-party components and licenses.

Pay special attention to:

- codecs
- FFmpeg configuration
- fonts
- AI models
- image libraries

---

# 105. PRODUCT DIFFERENTIATORS

supp.edit should eventually outperform the old multi-app workflow.

Build toward these differentiators:

### ONE UNIVERSAL TIMELINE

Video, audio, compositions and graphics together.

### ONE UNIVERSAL LAYER MODEL

Photos, video, shapes, text and AI assets share concepts.

### AI-NATIVE

AI modifies real editable project structure.

### LOCAL-FIRST

Professional editing should work without cloud dependency.

### OPEN PROJECT FORMAT

Documented and extensible.

### FAST

Rust + GPU + modern architecture.

### NONDESTRUCTIVE

Every operation should preserve originals whenever possible.

### ONE PROJECT

No constant exporting between separate editing applications.

---

# 106. FUTURE FEATURES TO ARCHITECT FOR

Do not necessarily implement these immediately, but avoid architecture that blocks them:

- real-time collaboration
- cloud rendering
- render farms
- mobile companion
- review portal
- plugin marketplace
- template marketplace
- stock asset integrations
- camera-to-cloud
- live streaming tools
- live production
- vector design workspace
- 3D scene compositing
- USD/glTF workflows
- neural rendering
- speech dubbing
- automatic localization
- AI video generation
- AI image generation
- AI sound generation
- agentic editing

---

# 107. ORIGINALITY REQUIREMENT

The application may implement functionality comparable to established creative tools, but supp.edit must establish its own:

- identity
- workflow
- interaction model
- design language
- icons
- terminology where useful
- architecture
- source code

Do not use protected logos or copyrighted UI graphics.

The goal is not an Adobe skin.

The goal is to build the next generation after fragmented legacy creative software.

---

# 108. YOUR BEHAVIOR AS THE CODING AGENT

You have authority to create:

- directories
- source files
- configs
- migrations
- tests
- schemas
- Rust crates
- TypeScript packages
- UI components
- native modules
- scripts
- documentation

Do not repeatedly ask me whether you should proceed.

Make reasonable senior-engineering decisions autonomously.

When there are several implementation choices:

1. analyze them internally
2. choose the strongest maintainable option
3. document the choice
4. implement it

Do not stop after describing code.

WRITE THE CODE.

Do not stop after planning.

BUILD.

Do not create placeholder-only screens.

IMPLEMENT VERTICAL SLICES.

When something requires external credentials:

- create the integration architecture
- add .env.example
- never fabricate credentials
- keep the rest functional without them

When something requires unsupported hardware:

- capability detect it
- provide fallback behavior

---

# 109. CONTINUOUS SELF-AUDIT

At the end of every major development cycle, inspect the entire application and ask:

- Which buttons do nothing?
- Which screens are fake?
- Which workflows fail?
- Which features lose state after reload?
- Which interactions are slow?
- Which files are becoming architectural bottlenecks?
- Which errors are swallowed?
- Which operations are destructive without warning?
- Which implementations are only cosmetic?
- Which components need tests?
- Which features break when media is missing?
- Which features break on another OS?

Fix these issues instead of merely listing them.

---

# 110. ACCEPTANCE PHILOSOPHY

A feature is NOT complete because its UI exists.

A feature is complete only when:

INPUT
→ ACTION
→ PROCESSING
→ VISIBLE RESULT
→ PROJECT STATE
→ SAVE
→ RELOAD
→ UNDO/REDO
→ TEST

all function correctly where applicable.

---

# 111. START NOW

First inspect the current repository.

If it is empty:

1. Create the architecture.
2. Initialize the Tauri + React + TypeScript application.
3. Establish Rust workspace/crates.
4. Create the supp.edit design system.
5. Build the project schema.
6. Implement project creation/open/save.
7. Implement real media import.
8. Implement the asset browser.
9. Integrate media metadata extraction.
10. Begin the functional playback/timeline vertical slice.

If code already exists:

DO NOT throw it away automatically.

Audit it.

Retain good architecture.

Refactor weak architecture.

Remove fake implementations.

Then continue building toward this specification.

Do not return only a roadmap.

Do not return only code snippets.

Modify/create the actual repository and continue implementation.

The mission is:

**Build supp.edit into the most capable unified, AI-native, local-first professional creative suite that modern desktop technology can support.**

Begin.