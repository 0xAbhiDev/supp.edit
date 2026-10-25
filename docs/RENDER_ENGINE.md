# Render engine

The maintained composition graph and resource architecture is [RENDER_ENGINE.md](../RENDER_ENGINE.md). Earlier GPU/cache/encoder implementation details are retained in [RENDER_ENGINE_GPU.md](RENDER_ENGINE_GPU.md).

Current export uses the shared in-memory job queue and recursive composition audio. There is one running job at a time; MP4 cannot pause and final muxing cannot currently be interrupted from the UI. No persistent export queue or native zero-copy renderer is claimed.
