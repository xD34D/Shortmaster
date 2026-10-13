import type { Sample } from "@/lib/corto/types";

export type Analysis = {
  samples: Sample[];
  duration: number;
  width: number;
  height: number;
  audio: "full" | "missing";
};

const MAX_AUDIO_BYTES = 90 * 1024 * 1024;

function normalize(values: number[]) {
  if (values.length === 0) return values;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  const cap = Math.max(sorted[index] ?? 0, 0.0008);
  return values.map((value) => Math.min(1, value / cap));
}

function waitFor(target: EventTarget, event: string, signal: AbortSignal, ms: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("TIMEOUT"));
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("UNREADABLE"));
    };
    function cleanup() {
      window.clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    }
    signal.addEventListener("abort", onAbort);
    target.addEventListener(event, onEvent);
    target.addEventListener("error", onError);
  });
}

function seekTo(video: HTMLVideoElement, time: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, 2200);
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    function cleanup() {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      signal.removeEventListener("abort", onAbort);
    }
    signal.addEventListener("abort", onAbort);
    video.addEventListener("seeked", onSeeked);
    if (Math.abs(video.currentTime - time) < 0.04 && video.readyState >= 2) {
      cleanup();
      resolve();
      return;
    }
    try {
      video.currentTime = time;
    } catch {
      cleanup();
      resolve();
    }
  });
}

async function decodeAudio(file: File | null, url: string, signal: AbortSignal) {
  try {
    let blob: Blob | null = null;
    if (file) {
      if (file.size > MAX_AUDIO_BYTES) return null;
      blob = file;
    } else {
      const response = await fetch(url, { signal });
      if (!response.ok) return null;
      const length = Number(response.headers.get("content-length") || 0);
      if (length > MAX_AUDIO_BYTES) return null;
      blob = await response.blob();
      if (blob.size > MAX_AUDIO_BYTES) return null;
    }
    const context = new AudioContext();
    try {
      const encoded = await blob.arrayBuffer();
      if (signal.aborted) return null;
      return await context.decodeAudioData(encoded);
    } finally {
      await context.close().catch(() => undefined);
    }
  } catch {
    return null;
  }
}

function rmsAt(buffer: AudioBuffer, time: number, windowSec: number) {
  const rate = buffer.sampleRate;
  const start = Math.max(0, Math.floor(time * rate));
  const end = Math.min(buffer.length, Math.floor((time + windowSec) * rate));
  if (end <= start) return 0;
  const step = Math.max(1, Math.floor((end - start) / 480));
  let energy = 0;
  let count = 0;
  const channels = Math.min(2, buffer.numberOfChannels);
  for (let channel = 0; channel < channels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let index = start; index < end; index += step) {
      const value = data[index] ?? 0;
      energy += value * value;
      count += 1;
    }
  }
  return count ? Math.sqrt(energy / count) : 0;
}

function frameDelta(
  data: Uint8ClampedArray,
  previous: Uint8ClampedArray | null,
) {
  if (!previous) return 0;
  let total = 0;
  let count = 0;
  const stride = 16;
  for (let index = 0; index < data.length; index += stride) {
    total += Math.abs(data[index]! - previous[index]!);
    total += Math.abs(data[index + 1]! - previous[index + 1]!);
    total += Math.abs(data[index + 2]! - previous[index + 2]!);
    count += 3;
  }
  return count ? total / (count * 255) : 0;
}

export async function analyzeSource(options: {
  url: string;
  file: File | null;
  signal: AbortSignal;
  onProgress: (value: number) => void;
}): Promise<Analysis> {
  const { url, file, signal, onProgress } = options;
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = url.startsWith("blob:") ? null : "anonymous";
  video.style.cssText =
    "position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:0;top:0";
  document.body.appendChild(video);

  const audioPromise = decodeAudio(file, url, signal);

  try {
    video.src = url;
    await waitFor(video, "loadeddata", signal, 20000);
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("UNREADABLE");
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) throw new Error("UNREADABLE");

    const longest = Math.max(width, height);
    const scale = 96 / longest;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.round(width * scale));
    canvas.height = Math.max(2, Math.round(height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("UNREADABLE");

    const hop = Math.max(0.35, duration / 120);
    const times: number[] = [];
    for (let time = 0; time < duration - 0.05; time += hop) times.push(time);
    if (times.length === 0) times.push(0);

    const motion: number[] = [];
    let previous: Uint8ClampedArray | null = null;

    for (let index = 0; index < times.length; index++) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const time = Math.min(times[index]!, Math.max(0, duration - 0.08));
      await seekTo(video, time, signal);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      let pixels: Uint8ClampedArray;
      try {
        pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      } catch {
        throw new Error("PROTECTED");
      }
      motion.push(frameDelta(pixels, previous));
      previous = new Uint8ClampedArray(pixels);
      onProgress((index + 1) / times.length);
    }

    const audioBuffer = await audioPromise;
    const audioValues = times.map((time) =>
      audioBuffer ? rmsAt(audioBuffer, time, hop) : 0,
    );
    const audioNorm = normalize(audioValues);
    const motionNorm = normalize(motion);
    const samples: Sample[] = times.map((time, index) => ({
      t: time,
      audio: audioNorm[index] ?? 0,
      motion: motionNorm[index] ?? 0,
    }));

    return {
      samples,
      duration,
      width,
      height,
      audio: audioBuffer ? "full" : "missing",
    };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
  }
}
