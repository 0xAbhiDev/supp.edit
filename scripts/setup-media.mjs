// Explicit local setup. No codecs are bundled into the application executable.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  openSync,
  closeSync,
  createWriteStream,
  createReadStream,
} from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import path from "node:path";

if (process.platform !== "win32") {
  console.log(
    "Install current FFmpeg and FFprobe using your platform package manager (brew install ffmpeg on macOS; apt install ffmpeg on Debian/Ubuntu). Then run npm run doctor. See https://ffmpeg.org/download.html.",
  );
  process.exit(1);
}
const source =
  "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const destination = path.resolve("work/media-tools"),
  archive = path.join(destination, "ffmpeg-release.zip");
mkdirSync(destination, { recursive: true });
console.log(
  "Downloading the current Windows essentials build linked by ffmpeg.org. Local GPLv3 tools only; see THIRD_PARTY.md before redistribution.",
);
const checksumResponse = await fetch(source + ".sha256", {
  signal: AbortSignal.timeout(30000),
});
if (!checksumResponse.ok)
  throw new Error("Could not retrieve publisher checksum");
const expected = (await checksumResponse.text())
  .trim()
  .split(/\s+/)[0]
  .toLowerCase();
if (!/^[a-f0-9]{64}$/.test(expected))
  throw new Error("Invalid publisher SHA-256");
let downloadUrl = source;
try {
  const releaseResponse = await fetch(
    "https://api.github.com/repos/GyanD/codexffmpeg/releases/latest",
    { signal: AbortSignal.timeout(15000) },
  );
  if (releaseResponse.ok) {
    const release = await releaseResponse.json();
    const asset = release.assets?.find((a) =>
      /^ffmpeg-[0-9.]+-essentials_build\.zip$/.test(a.name),
    );
    if (
      asset?.browser_download_url?.startsWith(
        "https://github.com/GyanD/codexffmpeg/releases/download/",
      )
    )
      downloadUrl = asset.browser_download_url;
  }
} catch {
  console.log(
    "Publisher mirror metadata unavailable; using the primary download.",
  );
}
let response = await fetch(downloadUrl, {
  signal: AbortSignal.timeout(900000),
});
if (!response.ok && downloadUrl !== source) {
  downloadUrl = source;
  response = await fetch(source, { signal: AbortSignal.timeout(900000) });
}
if (!response.ok || !response.body)
  throw new Error("Download failed: " + response.status);
let downloaded = 0,
  lastProgress = 0;
const progress = new Transform({
  transform(chunk, encoding, callback) {
    downloaded += chunk.length;
    if (downloaded - lastProgress >= 10 * 1024 * 1024) {
      lastProgress = downloaded;
      console.log(`Downloaded ${Math.round(downloaded / 1024 / 1024)} MiB`);
    }
    callback(null, chunk);
  },
});
await pipeline(
  Readable.fromWeb(response.body),
  progress,
  createWriteStream(archive),
);
const hash = createHash("sha256");
for await (const chunk of createReadStream(archive)) hash.update(chunk);
const actual = hash.digest("hex");
if (actual !== expected)
  throw new Error(
    "FFmpeg checksum mismatch; archive will not be used. Retry setup if the upstream release changed.",
  );
const listing = spawnSync("tar.exe", ["-tf", archive], {
  encoding: "utf8",
  windowsHide: true,
});
if (listing.status !== 0)
  throw new Error("Cannot list archive: " + listing.stderr);
const entries = listing.stdout.split(/\r?\n/);
const tools = {};
for (const name of ["ffmpeg", "ffprobe"]) {
  const matches = entries.filter((entry) =>
    entry.endsWith("/bin/" + name + ".exe"),
  );
  if (matches.length !== 1)
    throw new Error("Expected exactly one " + name + " binary");
  // Extract to an explicitly chosen local filename, never to archive-supplied paths.
  const file = path.join(destination, name + ".exe"),
    fd = openSync(file, "w");
  let result;
  try {
    result = spawnSync("tar.exe", ["-xOf", archive, matches[0]], {
      stdio: ["ignore", fd, "pipe"],
      windowsHide: true,
    });
  } finally {
    closeSync(fd);
  }
  if (result.status !== 0) throw new Error("Cannot extract " + name);
  tools[name] = file;
}
writeFileSync(
  path.join(destination, "tools.json"),
  JSON.stringify(
    {
      source,
      downloadUrl,
      sha256: actual,
      installedAt: new Date().toISOString(),
      ...tools,
    },
    null,
    2,
  ),
);
console.log(
  "Publisher SHA-256 verified. FFmpeg and FFprobe are ready in work/media-tools. npm run dev and npm run launch discover them automatically.",
);
