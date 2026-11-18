/** Wait for decoded pixels, not just the seek event queued on the media element.
 * A newly opened decoder can still have an old frame pending for presentation.
 * Register before changing currentTime and reject stale presentation timestamps.
 */
export function seekMedia(
  media: HTMLMediaElement,
  time: number,
  frameRate: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Already settled on this time with its frame decoded: seeking again presents no new
    // frame, so a presentation callback would never arrive and the wait would time out.
    if (
      !media.seeking &&
      media.readyState >= 2 &&
      Math.abs(media.currentTime - time) <= 0.0001
    ) {
      resolve();
      return;
    }
    const video = media instanceof HTMLVideoElement ? media : undefined;
    const callbacks = !!video?.requestVideoFrameCallback;
    let presented = !callbacks,
      callback = 0,
      lastPresented: number | undefined,
      seekedAt: number | undefined,
      grace: ReturnType<typeof setTimeout> | undefined;
    const clean = () => {
      clearTimeout(timer);
      if (grace) clearTimeout(grace);
      media.removeEventListener("seeked", ready);
      media.removeEventListener("loadeddata", ready);
      media.removeEventListener("error", fail);
      if (callback) video?.cancelVideoFrameCallback(callback);
    };
    const settled = () =>
      !media.seeking &&
      media.readyState >= 2 &&
      Math.abs(media.currentTime - time) <= 0.0001;
    const ready = (event?: Event) => {
      if (event?.type === "seeked") seekedAt = performance.now();
      if (!settled()) return;
      if (!presented) {
        // A paused video drawn only to a canvas is not guaranteed a presentation callback
        // (WebView2 sometimes delivers none). Once the seek has completed at this exact time
        // with decoded data, give the callback a short grace period, then accept the frame.
        grace ??= setTimeout(() => {
          if (!settled()) {
            grace = undefined;
            return;
          }
          clean();
          resolve();
        }, 400);
        return;
      }
      clean();
      resolve();
    };
    const fail = () => {
      clean();
      reject(
        new Error("Media seek failed before a decoded frame was available"),
      );
    };
    const timer = setTimeout(() => {
      clean();
      // Report the decoder's state so an intermittent failure leaves evidence of its cause.
      reject(
        new Error(
          "Timed out waiting for decoded media frame " +
            JSON.stringify({
              requested: Number(time.toFixed(4)),
              current: Number(media.currentTime.toFixed(4)),
              readyState: media.readyState,
              seeking: media.seeking,
              presented,
              lastPresented: lastPresented === undefined ? null : Number(lastPresented.toFixed(4)),
              seekedMsAgo: seekedAt === undefined ? null : Math.round(performance.now() - seekedAt),
              visibility: typeof document === "undefined" ? null : document.visibilityState,
            }),
        ),
      );
    }, 20000);
    media.addEventListener("seeked", ready);
    media.addEventListener("loadeddata", ready);
    media.addEventListener("error", fail);
    if (video && callbacks) {
      const observe: VideoFrameRequestCallback = (_now, metadata) => {
        lastPresented = metadata.mediaTime;
        // Presentation time is the source frame's start; the requested time may
        // lie between source frames, including a fractional speed-ramp sample.
        const tolerance = 1 / Math.max(1, frameRate) + 0.002;
        if (Math.abs(metadata.mediaTime - time) <= tolerance) {
          presented = true;
          ready();
        } else callback = video.requestVideoFrameCallback(observe);
      };
      callback = video.requestVideoFrameCallback(observe);
    }
    try {
      media.currentTime = time;
      ready();
    } catch (error) {
      clean();
      reject(error);
    }
  });
}
