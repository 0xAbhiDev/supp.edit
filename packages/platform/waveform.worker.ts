// Sample scanning runs outside the UI thread. Data is transferred, not cloned again.
self.onmessage = (event: MessageEvent<{ samples: Float32Array }>) => {
  const { samples } = event.data,
    peaks = new Float32Array(400);
  for (let i = 0; i < samples.length; i++) {
    const bin = Math.min(399, Math.floor((i * 400) / samples.length));
    peaks[bin] = Math.max(peaks[bin], Math.abs(samples[i]));
  }
  self.postMessage(Array.from(peaks));
};
export {};
