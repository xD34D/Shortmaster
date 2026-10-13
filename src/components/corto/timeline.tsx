import { useEffect, useRef } from "react";
import { clamp } from "@/lib/corto/media";
import type { Clip, Sample } from "@/lib/corto/types";

type Drag = {
  pointer: number;
  time: number;
  id: string | null;
  origin: number;
  moved: boolean;
};

export function Timeline({
  duration,
  samples,
  clips,
  activeId,
  currentTime,
  onSeek,
  onShift,
}: {
  duration: number;
  samples: Sample[];
  clips: Clip[];
  activeId: string | null;
  currentTime: number;
  onSeek: (time: number) => void;
  onShift: (id: string, start: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const draw = () => {
      const cssWidth = parent.clientWidth;
      const cssHeight = 88;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(cssWidth * ratio));
      canvas.height = Math.round(cssHeight * ratio);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      const context = canvas.getContext("2d");
      if (!context || duration <= 0) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, cssWidth, cssHeight);
      context.fillStyle = "#faf6ef";
      context.fillRect(0, 0, cssWidth, cssHeight);

      const bars = Math.max(40, Math.round(cssWidth / 5));
      const gap = 1;
      const barW = cssWidth / bars;
      for (let index = 0; index < bars; index++) {
        const a = (index / bars) * duration;
        const b = ((index + 1) / bars) * duration;
        let energy = 0;
        let count = 0;
        for (const sample of samples) {
          if (sample.t < a) continue;
          if (sample.t >= b) break;
          energy += sample.audio * 0.58 + sample.motion * 0.42;
          count += 1;
        }
        const value = count ? energy / count : 0;
        const h = Math.max(2, value * 62);
        context.fillStyle = value > 0.55 ? "#8d5a2b" : "rgba(28,23,18,0.18)";
        context.fillRect(index * barW + gap / 2, 74 - h, Math.max(1, barW - gap), h);
      }

      for (const clip of clips) {
        const x = (clip.start / duration) * cssWidth;
        const w = ((clip.end - clip.start) / duration) * cssWidth;
        const active = clip.id === activeId;
        context.fillStyle = active ? "rgba(141,90,43,0.16)" : "rgba(28,23,18,0.05)";
        context.fillRect(x, 6, w, 76);
        context.strokeStyle = active ? "#8d5a2b" : "rgba(28,23,18,0.28)";
        context.lineWidth = active ? 1.5 : 1;
        context.strokeRect(x + 0.5, 6.5, Math.max(0, w - 1), 75);
      }

      const playhead = (currentTime / duration) * cssWidth;
      context.fillStyle = "#1c1712";
      context.fillRect(playhead - 0.75, 0, 1.5, cssHeight);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [activeId, clips, currentTime, duration, samples]);

  const timeAt = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas || duration <= 0) return 0;
    const rect = canvas.getBoundingClientRect();
    return clamp(((clientX - rect.left) / rect.width) * duration, 0, duration);
  };

  return (
    <canvas
      ref={canvasRef}
      role="slider"
      tabIndex={0}
      aria-label="Linea del tempo e momenti scelti"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
      className="block w-full touch-none rounded-2xl bg-sheet"
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onSeek(clamp(currentTime - 1, 0, duration));
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          onSeek(clamp(currentTime + 1, 0, duration));
        }
      }}
      onPointerDown={(event) => {
        const time = timeAt(event.clientX);
        const hit =
          clips.find((clip) => clip.id === activeId && time >= clip.start && time <= clip.end) ??
          clips.find((clip) => time >= clip.start && time <= clip.end) ??
          null;
        dragRef.current = {
          pointer: event.clientX,
          time,
          id: hit?.id ?? null,
          origin: hit?.start ?? 0,
          moved: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag?.id) return;
        if (Math.abs(event.clientX - drag.pointer) < 4) return;
        drag.moved = true;
        const delta = timeAt(event.clientX) - drag.time;
        onShift(drag.id, drag.origin + delta);
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (!drag || !drag.moved) onSeek(timeAt(event.clientX));
      }}
    />
  );
}
