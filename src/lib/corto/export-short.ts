import { clamp, pickRecorderMime } from "@/lib/corto/media";

export async function exportShort(options: {
  url: string;
  start: number;
  end: number;
  width: number;
  height: number;
  focusX: number;
  focusY: number;
  title: string;
  fade: boolean;
  signal: AbortSignal;
  onProgress: (value: number) => void;
}): Promise<{ blob: Blob; mime: string }> {
  const mime = pickRecorderMime();
  if (!mime || typeof MediaRecorder === "undefined") {
    throw new Error("NO_RECORDER");
  }

  const {
    url,
    start,
    end,
    width,
    height,
    focusX,
    focusY,
    title,
    fade,
    signal,
    onProgress,
  } = options;
  const length = Math.max(0.4, end - start);
  const video = document.createElement("video");
  video.preload = "auto";
  video.playsInline = true;
  video.crossOrigin = url.startsWith("blob:") ? null : "anonymous";
  video.style.cssText =
    "position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:0;top:0";
  document.body.appendChild(video);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    video.remove();
    throw new Error("EXPORT");
  }

  let audioContext: AudioContext | null = null;
  let recorder: MediaRecorder | null = null;

  const throwIfAborted = () => {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  };

  try {
    video.src = url;
    await once(video, "loadedmetadata", signal, 20000);
    throwIfAborted();
    video.currentTime = clamp(start, 0, Math.max(0, video.duration - 0.05));
    await once(video, "seeked", signal, 8000);

    const cleanTitle = title.replace(/\s+/g, " ").trim().slice(0, 80);
    if (cleanTitle && document.fonts?.load) {
      const size = Math.round(width * 0.042);
      await document.fonts.load(`500 ${size}px Outfit`).catch(() => undefined);
    }

    audioContext = new AudioContext();
    await audioContext.resume().catch(() => undefined);
    const source = audioContext.createMediaElementSource(video);
    const destination = audioContext.createMediaStreamDestination();
    source.connect(destination);

    const canvasStream = canvas.captureStream(30);
    const stream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...destination.stream.getAudioTracks(),
    ]);

    drawFrame(context, video, {
      width,
      height,
      focusX,
      focusY,
      title: cleanTitle,
      alpha: fade ? 0 : 1,
    });

    const chunks: Blob[] = [];
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: width >= 1080 ? 7_000_000 : 4_200_000,
        audioBitsPerSecond: 128_000,
      });
    } catch {
      recorder = new MediaRecorder(stream, { mimeType: mime });
    }
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    const stopped = once(recorder, "stop", signal, length * 1000 + 20000).catch(() => undefined);
    recorder.start(250);

    try {
      await video.play();
    } catch {
      throw new Error("EXPORT");
    }
    const startedAt = performance.now();
    await new Promise<void>((resolve, reject) => {
      const step = () => {
        if (signal.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        const rel = video.currentTime - start;
        const alpha = fade ? fadeAlpha(rel, length) : 1;
        drawFrame(context, video, {
          width,
          height,
          focusX,
          focusY,
          title: cleanTitle,
          alpha,
        });
        onProgress(clamp(rel / length, 0, 1));
        const timedOut = performance.now() - startedAt > length * 1000 + 8000;
        if (timedOut || video.ended || video.currentTime >= end - 0.04) {
          resolve();
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });

    video.pause();
    drawFrame(context, video, {
      width,
      height,
      focusX,
      focusY,
      title: cleanTitle,
      alpha: fade ? 0 : 1,
    });
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    if (recorder.state !== "inactive") recorder.stop();
    await stopped.catch(() => undefined);
    onProgress(1);

    const type = recorder.mimeType || mime;
    const blob = new Blob(chunks, { type });
    if (blob.size < 800) throw new Error("EXPORT");
    return { blob, mime: type };
  } finally {
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    await audioContext?.close().catch(() => undefined);
  }
}

function fadeAlpha(rel: number, length: number) {
  const fadeIn = 0.35;
  const fadeOut = 0.5;
  let alpha = 1;
  if (rel < fadeIn) alpha = Math.max(0, rel / fadeIn);
  const remaining = length - rel;
  if (remaining < fadeOut) alpha = Math.min(alpha, Math.max(0, remaining / fadeOut));
  return alpha;
}

function drawFrame(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  frame: {
    width: number;
    height: number;
    focusX: number;
    focusY: number;
    title: string;
    alpha: number;
  },
) {
  const { width, height, focusX, focusY, title, alpha } = frame;
  context.filter = "none";
  context.globalAlpha = 1;
  context.fillStyle = "#16130f";
  context.fillRect(0, 0, width, height);
  if (video.videoWidth > 0 && alpha > 0.001) {
    const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
    const drawnW = video.videoWidth * scale;
    const drawnH = video.videoHeight * scale;
    const x = (width - drawnW) * focusX;
    const y = (height - drawnH) * focusY;
    context.filter = "contrast(1.04) saturate(0.95)";
    context.globalAlpha = alpha;
    context.drawImage(video, x, y, drawnW, drawnH);
    context.filter = "none";
    context.globalAlpha = 1;
  }
  if (title && alpha > 0.4) {
    drawTitle(context, title, width, height, alpha);
  }
}

function drawTitle(
  context: CanvasRenderingContext2D,
  title: string,
  width: number,
  height: number,
  alpha: number,
) {
  const pad = Math.round(width * 0.08);
  const size = Math.max(18, Math.round(width * 0.042));
  const maxWidth = width - pad * 2;
  context.globalAlpha = alpha;
  context.font = `500 ${size}px Outfit, sans-serif`;
  context.textBaseline = "top";
  context.textAlign = "left";
  const lines = wrap(context, title, maxWidth).slice(0, 2);
  const y = Math.round(height * 0.7);
  context.fillStyle = "#8d5a2b";
  context.fillRect(pad, y - Math.round(size * 0.55), Math.round(width * 0.11), Math.max(2, Math.round(width * 0.004)));
  context.fillStyle = "#f4efe6";
  lines.forEach((line, index) => {
    context.fillText(line, pad, y + index * (size * 1.25));
  });
  context.globalAlpha = 1;
}

function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (context.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function once(target: EventTarget, event: string, signal: AbortSignal, ms: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    function cleanup() {
      window.clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      signal.removeEventListener("abort", onAbort);
    }
    signal.addEventListener("abort", onAbort);
    target.addEventListener(event, onEvent, { once: true });
  });
}
