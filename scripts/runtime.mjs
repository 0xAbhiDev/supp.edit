import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
export function mediaEnvironment() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const env = { ...process.env },
    base = path.resolve("work/media-tools/tools.json");
  if (existsSync(base)) {
    const tools = JSON.parse(readFileSync(base, "utf8"));
    env.SUPP_FFMPEG ||= tools.ffmpeg;
    env.SUPP_FFPROBE ||= tools.ffprobe;
  }
  return env;
}
