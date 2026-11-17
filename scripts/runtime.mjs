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
/** Launch the pinned Playwright browser, or an installed Chrome/Edge when the
 * pinned build has not been downloaded. Nothing is fetched from the network. */
export async function launchBrowser(chromium) {
  if (process.env.SUPP_BROWSER_CHANNEL)
    return chromium.launch({ channel: process.env.SUPP_BROWSER_CHANNEL });
  if (existsSync(chromium.executablePath())) return chromium.launch();
  let failure;
  for (const channel of ["chrome", "msedge"])
    try {
      return await chromium.launch({ channel });
    } catch (e) {
      failure = e;
    }
  throw failure;
}
