export function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatSpan(start: number, end: number) {
  return `${formatClock(start)} – ${formatClock(end)}`;
}

export type LinkKind = "bad" | "youtube" | "social" | "direct";

const YOUTUBE = new Set([
  "youtube.com",
  "youtu.be",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
]);

const SOCIAL = new Set([
  "instagram.com",
  "tiktok.com",
  "vm.tiktok.com",
  "vimeo.com",
  "facebook.com",
  "fb.watch",
  "x.com",
  "twitter.com",
  "dailymotion.com",
]);

export function classifyLink(raw: string): LinkKind {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "bad";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "bad";
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (YOUTUBE.has(host)) return "youtube";
  if (SOCIAL.has(host)) return "social";
  return "direct";
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function extensionForMime(mime: string) {
  return mime.includes("mp4") ? "mp4" : "webm";
}

export function pickRecorderMime() {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}
