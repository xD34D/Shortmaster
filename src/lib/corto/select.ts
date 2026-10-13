import { clamp } from "@/lib/corto/media";
import type { Clip, Sample } from "@/lib/corto/types";

export type SelectMode = "auto" | "fixed";

type Peak = {
  t: number;
  audio: number;
  motion: number;
  energy: number;
};

type Placed = Peak & {
  start: number;
  end: number;
  score: number;
};

function energyOf(sample: Sample) {
  return sample.audio * 0.58 + sample.motion * 0.42;
}

function reasonsFor(peak: Peak) {
  const reasons: string[] = [];
  if (peak.audio >= 0.45 && peak.motion >= 0.45) reasons.push("Suono e movimento insieme");
  else if (peak.audio >= peak.motion && peak.audio >= 0.4) reasons.push("Audio pieno");
  else if (peak.motion > peak.audio && peak.motion >= 0.4) reasons.push("Movimento deciso");
  else reasons.push("Passaggio più presente");
  if (peak.energy >= 0.72 && reasons.length < 2) reasons.push("Momento netto");
  return reasons.slice(0, 2);
}

function findPeaks(samples: Sample[], length: number, limit: number): Peak[] {
  const points = samples.map((sample) => ({
    t: sample.t,
    audio: sample.audio,
    motion: sample.motion,
    energy: energyOf(sample),
  }));
  if (points.length === 0) return [];
  const maxEnergy = points.reduce((best, point) => Math.max(best, point.energy), 0);
  const cutoff = Math.max(0.2, maxEnergy * 0.58);
  const regions: { start: number; end: number; peak: Peak }[] = [];
  let open: { start: number; end: number; peak: Peak } | null = null;

  for (const point of points) {
    if (point.energy >= cutoff) {
      if (!open) open = { start: point.t, end: point.t, peak: point };
      open.end = point.t;
      if (point.energy > open.peak.energy) open.peak = point;
    } else if (open) {
      regions.push(open);
      open = null;
    }
  }
  if (open) regions.push(open);

  const merged: typeof regions = [];
  for (const region of regions) {
    const prev = merged[merged.length - 1];
    if (prev && region.start - prev.end < 5) {
      prev.end = region.end;
      if (region.peak.energy > prev.peak.energy) prev.peak = region.peak;
    } else {
      merged.push({ ...region });
    }
  }

  const peaks: Peak[] = [];
  for (const region of merged) {
    const span = Math.max(0.2, region.end - region.start);
    if (span < length * 1.2) {
      peaks.push(region.peak);
      continue;
    }
    const slices = Math.min(limit, Math.max(1, Math.floor(span / length)));
    const step = span / slices;
    for (let index = 0; index < slices; index++) {
      const from = region.start + index * step;
      const to = index === slices - 1 ? region.end + 0.001 : from + step;
      let best = region.peak;
      let found = false;
      for (const point of points) {
        if (point.t < from || point.t >= to) continue;
        if (!found || point.energy > best.energy) {
          best = point;
          found = true;
        }
      }
      if (found) peaks.push(best);
    }
  }

  if (peaks.length === 0) {
    const best = points.reduce((top, point) => (point.energy > top.energy ? point : top));
    peaks.push(best);
  }
  return peaks;
}

function overlaps(start: number, end: number, placed: Placed[]) {
  return placed.some((other) => Math.min(end, other.end) - Math.max(start, other.start) > 0.4);
}

function packPeaks(peaks: Peak[], length: number, duration: number): Placed[] {
  const last = Math.max(0, duration - length);
  const lead = Math.min(4, length * 0.1);
  let items: Placed[] = peaks.map((peak) => {
    const start = clamp(peak.t - lead, 0, last);
    return { ...peak, start, end: Math.min(duration, start + length), score: peak.energy };
  });

  for (let pass = 0; pass < 8 && items.length > 1; pass++) {
    items.sort((a, b) => a.start - b.start);
    let changed = false;
    for (let index = 0; index < items.length - 1; index++) {
      const left = items[index]!;
      const right = items[index + 1]!;
      const overlap = left.end - right.start;
      if (overlap <= 0.2) continue;
      const push = overlap + 0.3;
      const leftStart = left.start - push;
      const leftFits =
        leftStart >= -0.05 && left.t >= leftStart - 0.05 && left.t <= leftStart + length + 0.05;
      const rightStart = right.start + push;
      const rightFits =
        rightStart <= last + 0.05 && right.t >= rightStart - 0.05 && right.t <= rightStart + length + 0.05;
      if (leftFits) {
        left.start = Math.max(0, leftStart);
        left.end = left.start + length;
        changed = true;
      } else if (rightFits) {
        right.start = Math.min(last, rightStart);
        right.end = right.start + length;
        changed = true;
      } else if (right.score <= left.score) {
        items.splice(index + 1, 1);
        changed = true;
        index -= 1;
      } else {
        items.splice(index, 1);
        changed = true;
        index -= 1;
      }
    }
    if (!changed) break;
  }

  return items.filter((item) => item.end - item.start > length * 0.85);
}

function scoreWindow(samples: Sample[], start: number, end: number) {
  let peak: Peak = { t: start, audio: 0, motion: 0, energy: -1 };
  let count = 0;
  let mean = 0;
  for (const sample of samples) {
    if (sample.t < start || sample.t >= end) continue;
    const energy = energyOf(sample);
    mean += energy;
    count += 1;
    if (energy > peak.energy) {
      peak = { t: sample.t, audio: sample.audio, motion: sample.motion, energy };
    }
  }
  return {
    peak: peak.energy < 0 ? { t: start + (end - start) * 0.3, audio: 0, motion: 0, energy: 0 } : peak,
    score: (count ? mean / count : 0) * 0.35 + Math.max(0, peak.energy) * 0.65,
  };
}

export function selectShorts(
  samples: Sample[],
  duration: number,
  target: number,
  limit: number,
  mode: SelectMode,
): Clip[] {
  if (!Number.isFinite(duration) || duration <= 0.2) return [];
  const length = Math.min(Math.max(target, 1), duration);
  const cap = Math.max(1, Math.min(4, limit));

  if (duration <= target + 0.35 || samples.length === 0) {
    const peak = samples.reduce(
      (best, sample) => {
        const energy = energyOf(sample);
        return energy > best.energy
          ? { t: sample.t, audio: sample.audio, motion: sample.motion, energy }
          : best;
      },
      { t: Math.min(1, duration / 2), audio: 0, motion: 0, energy: -1 },
    );
    return [
      {
        id: "intero",
        start: 0,
        end: duration,
        score: 1,
        peak: clamp(peak.t, 0, Math.max(0, duration - 0.05)),
        reasons: [duration + 0.2 < target ? "Video più corto del formato" : "Video intero"],
      },
    ];
  }

  const peaks = findPeaks(samples, length, cap);
  let placed = packPeaks(peaks, length, duration).sort((a, b) => b.score - a.score);

  if (mode === "auto" && placed.length > 1) {
    const best = placed[0]!.score;
    const strong = placed.filter((item) => item.score >= best * 0.62);
    if (strong.length > 0) placed = strong;
  }

  if (mode === "fixed" && placed.length < cap) {
    const step = Math.min(1, Math.max(0.5, length / 40));
    const extras: Placed[] = [];
    for (let start = 0; start <= duration - length + 0.001; start += step) {
      const end = start + length;
      if (overlaps(start, end, [...placed, ...extras])) continue;
      const scored = scoreWindow(samples, start, end);
      extras.push({ ...scored.peak, start, end, score: scored.score });
    }
    extras.sort((a, b) => b.score - a.score);
    for (const extra of extras) {
      if (placed.length >= cap) break;
      if (overlaps(extra.start, extra.end, placed)) continue;
      placed.push(extra);
    }
  }

  placed.sort((a, b) => b.score - a.score);
  placed = placed.slice(0, cap);
  placed.sort((a, b) => a.start - b.start);

  return placed.map((item, index) => ({
    id: `c${index}-${Math.round(item.start * 10)}`,
    start: item.start,
    end: item.end,
    score: item.score,
    peak: clamp(item.t, item.start, item.end),
    reasons: reasonsFor(item),
  }));
}
