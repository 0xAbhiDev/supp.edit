# Build and development

Use `npm install`, optionally `npm run setup:media`, and `npm run dev`. Rustup selects Rust 1.90 from the repository pin. Cargo limits parallel jobs to two to reduce memory pressure while compiling Windows/webview bindings. Node 22 is the tested runtime.

Windows: MSVC C++ build tools, Windows SDK and WebView2. macOS: Xcode command line tools. Linux: consult the official [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for the distribution's WebKitGTK 4.1, GTK and development packages. Windows is the only host built in this session; macOS and Linux remain unverified.

`npm run build:desktop` compiles the frontend and creates platform bundles. Production installers must be signed by the product owner. No update endpoint, signing key, certificate or fake update flow is shipped. To build an embedded debug executable without an installer:

```sh
npm run build
cargo build -p supp-desktop --features tauri/custom-protocol
```

Plain `cargo build -p supp-desktop` uses the configured development URL; the `tauri/custom-protocol` feature embeds the built frontend. `npm run launch` chooses `bin`, then release, then debug output.

FFmpeg and FFprobe are external tools. Runtime detection reads `SUPP_FFMPEG` / `SUPP_FFPROBE` or PATH. `npm run dev`, `npm run launch`, and the Windows `Start supp.edit.cmd` launcher load `.env` and discover tools from `npm run setup:media`. Directly double-clicking the executable requires tools on PATH or environment variables already configured. `.env.example` documents variable names; it is not loaded into the frontend.

On Windows, setup downloads the current [Gyan release essentials ZIP](https://www.gyan.dev/ffmpeg/builds/), a Windows provider linked by [FFmpeg](https://ffmpeg.org/download.html). It verifies the publisher's SHA-256 before extracting only `ffmpeg.exe` and `ffprobe.exe` to fixed filenames. It uses Windows' built-in `tar.exe`. The manifest at `work/media-tools/tools.json` records the source, checksum and installation time. The archive and manifest are local generated files, excluded from source distribution. On macOS/Linux, install current FFmpeg through your platform package manager.

`npm run doctor` checks tool availability. Hardware APIs listed by FFmpeg are advertised compile-time capabilities and do not prove the machine has working hardware support. The current exporter deliberately uses the detected software `libx264` encoder.

Run validation commands from README. Avoid running the initial full Rust compile and browser tests simultaneously on memory-constrained computers. Test-media fixtures are generated locally; never use private media as committed fixtures.
