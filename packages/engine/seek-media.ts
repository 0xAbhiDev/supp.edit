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
    const video = media instanceof HTMLVideoElement ? media : undefined;
    const callbacks = !!video?.requestVideoFrameCallback;
    let presented = !callbacks,
      callback = 0;
    const clean = () => {
      clearTimeout(timer);
      media.removeEventListener("seeked", ready);
      media.removeEventListener("loadeddata", ready);
      media.removeEventListener("error", fail);
      if (callback) video?.cancelVideoFrameCallback(callback);
    };
    const ready = () => {
      if (
        !presented ||
        media.seeking ||
        media.readyState < 2 ||
        Math.abs(media.currentTime - time) > 0.0001
      )
        return;
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
      reject(new Error("Timed out waiting for decoded media frame"));
    }, 20000);
    media.addEventListener("seeked", ready);
    media.addEventListener("loadeddata", ready);
    media.addEventListener("error", fail);
    if (video && callbacks) {
      const observe: VideoFrameRequestCallback = (_now, metadata) => {
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
