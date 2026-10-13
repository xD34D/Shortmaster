export type Sample = {
  t: number;
  audio: number;
  motion: number;
};

export type Clip = {
  id: string;
  start: number;
  end: number;
  score: number;
  peak: number;
  reasons: string[];
  tuned?: boolean;
};

export type Aspect = "9:16" | "4:5" | "1:1";
export type Quality = "720" | "1080";
export type CountMode = "auto" | 1 | 2 | 3 | 4;

export type Settings = {
  durationSec: number;
  countMode: CountMode;
  aspect: Aspect;
  focusX: number;
  focusY: number;
  title: string;
  quality: Quality;
  guides: boolean;
  fade: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  durationSec: 60,
  countMode: "auto",
  aspect: "9:16",
  focusX: 0.5,
  focusY: 0.42,
  title: "",
  quality: "720",
  guides: true,
  fade: true,
};

export function outputSize(aspect: Aspect, quality: Quality) {
  const short = quality === "1080" ? 1080 : 720;
  const long = quality === "1080" ? 1920 : 1280;
  if (aspect === "1:1") return { width: short, height: short };
  if (aspect === "4:5") return { width: short, height: Math.round((short * 5) / 4) };
  return { width: short, height: long };
}

export function aspectLabel(aspect: Aspect) {
  if (aspect === "1:1") return "1:1";
  if (aspect === "4:5") return "4:5";
  return "9:16";
}
