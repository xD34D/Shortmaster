import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import * as Slider from "@radix-ui/react-slider";
import { Download, Pause, Play } from "lucide-react";
import { analyzeSource } from "@/lib/corto/analyze";
import { exportShort } from "@/lib/corto/export-short";
import {
  classifyLink,
  clamp,
  extensionForMime,
  formatClock,
  formatSpan,
} from "@/lib/corto/media";
import { selectShorts } from "@/lib/corto/select";
import { grabVideo, type GrabProgress } from "@/lib/grab-video";
import {
  DEFAULT_SETTINGS,
  aspectLabel,
  outputSize,
  type Aspect,
  type Clip,
  type CountMode,
  type Quality,
  type Sample,
  type Settings,
} from "@/lib/corto/types";
import { Timeline } from "@/components/corto/timeline";

const STORAGE_KEY = "corto-settings";

function sanitize(value: Partial<Settings>): Partial<Settings> {
  const next: Partial<Settings> = {};
  if (typeof value.durationSec === "number" && Number.isFinite(value.durationSec)) {
    next.durationSec = clamp(Math.round(value.durationSec), 10, 90);
  }
  if (
    value.countMode === "auto" ||
    value.countMode === 1 ||
    value.countMode === 2 ||
    value.countMode === 3 ||
    value.countMode === 4
  ) {
    next.countMode = value.countMode;
  }
  if (value.aspect === "9:16" || value.aspect === "4:5" || value.aspect === "1:1") {
    next.aspect = value.aspect;
  }
  if (typeof value.focusX === "number") next.focusX = clamp(value.focusX, 0, 1);
  if (typeof value.focusY === "number") next.focusY = clamp(value.focusY, 0, 1);
  if (typeof value.title === "string") next.title = value.title.slice(0, 80);
  if (value.quality === "720" || value.quality === "1080") next.quality = value.quality;
  if (typeof value.guides === "boolean") next.guides = value.guides;
  if (typeof value.fade === "boolean") next.fade = value.fade;
  return next;
}

function explain(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return null;
  const code = error instanceof Error ? error.message : "";
  if (code === "PROTECTED") {
    return "Questo server non lascia leggere i fotogrammi. Scarica il file e caricalo dal dispositivo.";
  }
  if (code === "TIMEOUT") return "Il video ha impiegato troppo a rispondere. Riprova o carica il file.";
  if (code === "UNREADABLE") {
    return "Non riesco a leggere questo video. Usa mp4 o webm, oppure un link diretto al file.";
  }
  if (code === "NO_RECORDER") {
    return "Questo browser non può creare il file. Apri Corto con Chrome, Edge o Firefox.";
  }
  if (code === "EXPORT") return "L'esportazione si è interrotta. Riprova e tieni la pagina aperta.";
  return "Non sono riuscito a completare l'operazione. Riprova.";
}

const megabytes = (bytes: number) => (bytes / 1048576).toFixed(1).replace(".", ",");

function saveFile(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 4000);
}

export function Studio() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [link, setLink] = useState("");
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"empty" | "analyzing" | "ready">("empty");
  const [progress, setProgress] = useState(0);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [samples, setSamples] = useState<Sample[]>([]);
  const [duration, setDuration] = useState(0);
  const [mediaSize, setMediaSize] = useState<{ w: number; h: number } | null>(null);
  const [audioMode, setAudioMode] = useState<"full" | "missing">("full");
  const [clips, setClips] = useState<Clip[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reelPlaying, setReelPlaying] = useState(false);
  const [exporting, setExporting] = useState<{ id: string; progress: number } | null>(null);
  const [grab, setGrab] = useState<GrabProgress | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLVideoElement>(null);
  const phoneRef = useRef<HTMLVideoElement>(null);
  const ownedUrl = useRef<string | null>(null);
  const jobRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const grabAbort = useRef<AbortController | null>(null);
  const exportAbort = useRef<AbortController | null>(null);
  const exportLock = useRef(false);
  const clipsRef = useRef(clips);
  clipsRef.current = clips;

  const limit = settings.countMode === "auto" ? 3 : settings.countMode;
  const mode = settings.countMode === "auto" ? "auto" : "fixed";
  const suggested = useMemo(() => {
    if (samples.length === 0 || duration <= 0) return [];
    return selectShorts(samples, duration, settings.durationSec, limit, mode);
  }, [duration, limit, mode, samples, settings.durationSec]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = sanitize(JSON.parse(raw) as Partial<Settings>);
      setSettings((current) => ({ ...current, ...parsed }));
    } catch {
      /* prefer the built-in 60s preset */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* private mode */
    }
  }, [settings]);

  useEffect(() => {
    setClips(suggested);
    setActiveId((current) =>
      current && suggested.some((clip) => clip.id === current) ? current : (suggested[0]?.id ?? null),
    );
  }, [suggested]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      grabAbort.current?.abort();
      exportAbort.current?.abort();
      if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
    };
  }, []);

  const thumbKey = clips
    .map((clip) => `${clip.id}:${Math.round(clip.start * 2)}:${Math.round(clip.peak * 2)}`)
    .join("|");

  useEffect(() => {
    if (!sourceUrl || clipsRef.current.length === 0) return;
    let cancel = false;
    const timer = window.setTimeout(() => {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      if (!sourceUrl.startsWith("blob:")) video.crossOrigin = "anonymous";
      video.src = sourceUrl;
      const canvas = document.createElement("canvas");
      canvas.width = 180;
      canvas.height = settings.aspect === "1:1" ? 180 : settings.aspect === "4:5" ? 225 : 320;
      const paint = async () => {
        try {
          await new Promise<void>((resolve, reject) => {
            const ok = () => {
              video.removeEventListener("loadeddata", ok);
              resolve();
            };
            const bad = () => {
              video.removeEventListener("error", bad);
              reject(new Error("thumb"));
            };
            video.addEventListener("loadeddata", ok, { once: true });
            video.addEventListener("error", bad, { once: true });
          });
        } catch {
          return;
        }
        for (const clip of clipsRef.current) {
          if (cancel) return;
          const inside = clip.peak >= clip.start && clip.peak <= clip.end;
          const at = inside ? clip.peak : clip.start + (clip.end - clip.start) * 0.35;
          video.currentTime = clamp(at, 0, Math.max(0, (video.duration || at) - 0.05));
          await new Promise<void>((resolve) => {
            const done = () => {
              video.removeEventListener("seeked", done);
              resolve();
            };
            video.addEventListener("seeked", done);
            window.setTimeout(done, 1200);
          });
          if (cancel || !video.videoWidth) continue;
          const context = canvas.getContext("2d");
          if (!context) continue;
          context.fillStyle = "#16130f";
          context.fillRect(0, 0, canvas.width, canvas.height);
          const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
          const drawnW = video.videoWidth * scale;
          const drawnH = video.videoHeight * scale;
          context.drawImage(
            video,
            (canvas.width - drawnW) * settings.focusX,
            (canvas.height - drawnH) * settings.focusY,
            drawnW,
            drawnH,
          );
          try {
            const pic = canvas.toDataURL("image/jpeg", 0.74);
            if (!cancel) setThumbs((current) => ({ ...current, [clip.id]: pic }));
          } catch {
            /* tainted frame */
          }
        }
        video.pause();
        video.removeAttribute("src");
        video.load();
      };
      void paint();
    }, 280);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [settings.aspect, settings.focusX, settings.focusY, sourceUrl, thumbKey]);

  const active = clips.find((clip) => clip.id === activeId) ?? clips[0] ?? null;
  const wide = !!mediaSize && mediaSize.w / Math.max(1, mediaSize.h) > 1.15 && settings.aspect !== "1:1";
  const tuned = clips.some((clip, index) => {
    const origin = suggested[index];
    return !origin || Math.abs(origin.start - clip.start) > 0.2 || clip.tuned;
  });

  function update(patch: Partial<Settings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  function adoptUrl(url: string, owned: boolean) {
    if (ownedUrl.current && ownedUrl.current !== url) URL.revokeObjectURL(ownedUrl.current);
    ownedUrl.current = owned ? url : null;
    setSourceUrl(url);
  }

  async function begin(url: string, file: File | null, name: string, owned: boolean) {
    stopGrab();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const job = ++jobRef.current;
    adoptUrl(url, owned);
    setSourceName(name);
    setError(null);
    setPhase("analyzing");
    setProgress(0);
    setSamples([]);
    setClips([]);
    setThumbs({});
    setDuration(0);
    setTime(0);
    setPlaying(false);
    try {
      const result = await analyzeSource({
        url,
        file,
        signal: controller.signal,
        onProgress: (value) => {
          if (jobRef.current === job) setProgress(value);
        },
      });
      if (jobRef.current !== job) return;
      setSamples(result.samples);
      setDuration(result.duration);
      setMediaSize({ w: result.width, h: result.height });
      setAudioMode(result.audio);
      setPhase("ready");
    } catch (caught) {
      if (jobRef.current !== job) return;
      const message = explain(caught);
      if (!message) return;
      setPhase("empty");
      setSourceUrl(null);
      setError(message);
    }
  }

  function stopGrab() {
    grabAbort.current?.abort();
    grabAbort.current = null;
    setGrab(null);
  }

  async function grabLink(url: string) {
    stopGrab();
    const controller = new AbortController();
    grabAbort.current = controller;
    setError(null);
    setGrab({ loaded: 0, total: null });
    try {
      const file = await grabVideo(url, {
        signal: controller.signal,
        onProgress: (value) => {
          if (grabAbort.current === controller) setGrab(value);
        },
      });
      if (grabAbort.current !== controller) return;
      grabAbort.current = null;
      setGrab(null);
      takeFile(file);
    } catch (caught) {
      if (grabAbort.current !== controller) return;
      grabAbort.current = null;
      setGrab(null);
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : "Non sono riuscito a scaricare il video. Riprova.",
      );
    }
  }

  function takeFile(file: File) {
    if (file.size < 1000) {
      setError("Il file è vuoto o troppo piccolo.");
      return;
    }
    const looksVideo =
      file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v|ogv|mkv)$/i.test(file.name);
    if (!looksVideo) {
      setError("Serve un file video: mp4, webm o mov.");
      return;
    }
    const url = URL.createObjectURL(file);
    void begin(url, file, file.name, true);
  }

  function openLink(event: FormEvent) {
    event.preventDefault();
    const kind = classifyLink(link);
    if (kind === "bad") {
      setError("Incolla un indirizzo che inizia con http o https.");
      return;
    }
    if (kind === "youtube") {
      void grabLink(link.trim());
      return;
    }
    if (kind === "social") {
      setError(
        "Instagram, TikTok e Vimeo non lasciano leggere il file dal browser. Scarica il video, se ne hai il diritto, e caricalo qui. Oppure incolla un link YouTube o un link diretto a un mp4 o webm.",
      );
      return;
    }
    void begin(link.trim(), null, "Video dal link", false);
  }

  function seek(next: number) {
    const video = stageRef.current;
    const bounded = clamp(next, 0, duration || video?.duration || 0);
    if (video) video.currentTime = bounded;
    setTime(bounded);
  }

  function toggleStage() {
    const video = stageRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }

  function shiftClip(id: string, start: number) {
    setClips((current) =>
      current.map((clip) => {
        if (clip.id !== id) return clip;
        const span = clip.end - clip.start;
        const next = clamp(start, 0, Math.max(0, duration - span));
        return { ...clip, start: next, end: next + span, tuned: true };
      }),
    );
    setActiveId(id);
  }

  function toggleReel() {
    const video = phoneRef.current;
    if (!video || !active) return;
    if (!video.paused) {
      video.pause();
      setReelPlaying(false);
      return;
    }
    video.currentTime = active.start;
    void video.play();
    setReelPlaying(true);
  }

  async function download(clip: Clip, index: number) {
    if (!sourceUrl || exportLock.current) return false;
    exportLock.current = true;
    const controller = new AbortController();
    exportAbort.current = controller;
    setExporting({ id: clip.id, progress: 0 });
    setError(null);
    const { width, height } = outputSize(settings.aspect, settings.quality);
    try {
      const result = await exportShort({
        url: sourceUrl,
        start: clip.start,
        end: clip.end,
        width,
        height,
        focusX: settings.focusX,
        focusY: settings.focusY,
        title: settings.title,
        fade: settings.fade,
        signal: controller.signal,
        onProgress: (value) => setExporting({ id: clip.id, progress: value }),
      });
      const ext = extensionForMime(result.mime);
      const seconds = Math.max(1, Math.round(clip.end - clip.start));
      saveFile(result.blob, `corto-${String(index + 1).padStart(2, "0")}-${seconds}s.${ext}`);
      return true;
    } catch (caught) {
      const message = explain(caught);
      if (message) setError(message);
      return false;
    } finally {
      exportLock.current = false;
      setExporting(null);
    }
  }

  async function downloadAll() {
    for (let index = 0; index < clips.length; index++) {
      const clip = clips[index];
      if (!clip) return;
      const ok = await download(clip, index);
      if (!ok) return;
    }
  }

  const counts: CountMode[] = ["auto", 1, 2, 3, 4];
  const aspects: Aspect[] = ["9:16", "4:5", "1:1"];
  const qualities: Quality[] = ["720", "1080"];
  const phoneAspect =
    settings.aspect === "1:1" ? "aspect-square" : settings.aspect === "4:5" ? "aspect-portrait" : "aspect-reel";

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="border-b border-ink/10">
        <div className="mx-auto flex max-w-6xl items-end justify-between gap-4 px-4 py-4 sm:px-6">
          <div>
            <p className="font-display text-3xl leading-none tracking-tight">Corto</p>
            <p className="mt-1 text-sm text-ink/60">Studio per shorts</p>
          </div>
          <p className="text-right text-sm text-ink/70">
            {settings.durationSec}s · pulito · {aspectLabel(settings.aspect)}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        {error ? (
          <p role="alert" className="mb-6 rounded-2xl bg-sheet px-4 py-3 text-sm leading-relaxed ring-1 ring-ink/10">
            {error}
          </p>
        ) : null}

        {!sourceUrl ? (
          <Intake
            link={link}
            over={over}
            onLink={setLink}
            onSubmit={openLink}
            grab={grab}
            onCancelGrab={stopGrab}
            onFile={takeFile}
            onDemo={() => void begin("/demo.mp4", null, "Video dimostrativo", false)}
            onBrowse={() => fileRef.current?.click()}
            onOver={setOver}
            fileRef={fileRef}
          />
        ) : (
          <div className="grid items-start gap-8 lg:grid-cols-5">
            <section className="min-w-0 lg:col-span-3">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h1 className="truncate text-sm font-medium">{sourceName}</h1>
                <button
                  type="button"
                  className="shrink-0 text-sm text-ink/60 underline-offset-4 hover:underline"
                  onClick={() => {
                    abortRef.current?.abort();
                    setPhase("empty");
                    setSourceUrl(null);
                    setSamples([]);
                    setClips([]);
                  }}
                >
                  Cambia video
                </button>
              </div>

              <div className="relative overflow-hidden rounded-2xl bg-stage shadow-xl">
                <video
                  ref={stageRef}
                  src={sourceUrl}
                  playsInline
                  preload="metadata"
                  className="max-h-96 w-full bg-stage object-contain"
                  onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                />
                {phase !== "analyzing" ? (
                  <button
                    type="button"
                    onClick={toggleStage}
                    aria-label={playing ? "Pausa" : "Riproduci"}
                    className="absolute bottom-3 left-3 flex size-11 items-center justify-center rounded-full bg-ivory text-ink"
                  >
                    {playing ? <Pause className="size-5" /> : <Play className="size-5 translate-x-px" />}
                  </button>
                ) : null}
                {phase === "analyzing" ? (
                  <div className="absolute inset-0 flex flex-col justify-end bg-stage/55 p-4 text-ivory">
                    <p className="text-sm">Lettura di audio e movimento</p>
                    <p className="mt-1 font-display text-3xl leading-none">{Math.round(progress * 100)}%</p>
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-ivory/20">
                      <div className="h-full bg-brass" style={{ width: `${Math.round(progress * 100)}%` }} />
                    </div>
                  </div>
                ) : null}
              </div>

              {phase === "ready" ? (
                <>
                  <div className="mt-3 flex items-center justify-between text-sm text-ink/60">
                    <span>{formatClock(time)}</span>
                    <span>{formatClock(duration)}</span>
                  </div>
                  <div className="mt-2">
                    <Timeline
                      duration={duration}
                      samples={samples}
                      clips={clips}
                      activeId={active?.id ?? null}
                      currentTime={time}
                      onSeek={seek}
                      onShift={shiftClip}
                    />
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-ink/60">
                    Le barre alte sono i passaggi più pieni. Il riquadro è lo short: trascinalo per spostarlo, la durata non cambia.
                  </p>
                  {audioMode === "missing" ? (
                    <p className="mt-2 text-sm text-ink/60">
                      L'audio non era leggibile: i tagli seguono solo il movimento.
                    </p>
                  ) : null}

                  <div className="mt-6 flex items-baseline justify-between gap-3">
                    <h2 className="font-display text-2xl tracking-tight">
                      {clips.length === 1 ? "Un taglio" : `${clips.length} tagli`}
                    </h2>
                    {tuned ? (
                      <button type="button" className="text-sm text-brass" onClick={() => setClips(suggested)}>
                        Ripristina
                      </button>
                    ) : null}
                  </div>

                  <ul className="mt-4 flex flex-col gap-3">
                    {clips.map((clip, index) => {
                      const on = clip.id === active?.id;
                      const rank = [...clips].sort((a, b) => b.score - a.score).findIndex((item) => item.id === clip.id);
                      return (
                        <li key={clip.id}>
                          <div
                            className={`flex gap-3 rounded-2xl bg-sheet p-3 ring-1 ${on ? "ring-ink" : "ring-ink/10"}`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setActiveId(clip.id);
                                seek(clip.start);
                              }}
                              className="relative w-14 shrink-0 overflow-hidden rounded-xl bg-stage"
                            >
                              <span className={phoneAspect + " block w-full"}>
                                {thumbs[clip.id] ? (
                                  <img src={thumbs[clip.id]} alt="" className="h-full w-full object-cover" />
                                ) : null}
                              </span>
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline justify-between gap-2">
                                <p className="text-sm font-medium">
                                {rank === 0 ? "Il più pieno" : rank === 1 ? "Secondo momento" : `Momento ${rank + 1}`}
                              </p>
                                <p className="text-sm text-ink/55">{formatSpan(clip.start, clip.end)}</p>
                              </div>
                              <p className="mt-1 text-sm text-ink/65">
                                {clip.reasons.join(" · ")}
                                {clip.tuned ? " · posizione ritoccata" : ""}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {[-5, -1, 1, 5].map((delta) => (
                                  <button
                                    key={delta}
                                    type="button"
                                    className="seg bg-paper ring-1 ring-ink/10"
                                    onClick={() => shiftClip(clip.id, clip.start + delta)}
                                  >
                                    {delta > 0 ? `+${delta}s` : `${delta}s`}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <span className="hidden pt-1 text-sm text-ink/40 sm:inline">{String(index + 1).padStart(2, "0")}</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : null}
            </section>

            <aside className="min-w-0 lg:col-span-2 lg:sticky lg:top-4">
              <div className={`relative mx-auto w-full max-w-60 overflow-hidden rounded-2xl bg-stage ring-1 ring-ink/10 ${phoneAspect}`}>
                {phase === "ready" ? (
                  <video
                    ref={phoneRef}
                    src={sourceUrl}
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-cover"
                    style={{ objectPosition: `${settings.focusX * 100}% ${settings.focusY * 100}%` }}
                    onTimeUpdate={(event) => {
                      if (!active) return;
                      if (event.currentTarget.currentTime >= active.end - 0.08) {
                        event.currentTarget.currentTime = active.start;
                      }
                    }}
                    onPause={() => setReelPlaying(false)}
                    onPlay={() => setReelPlaying(true)}
                  />
                ) : (
                  <div className="flex h-full items-end p-4 text-sm text-ivory/80">In attesa del taglio</div>
                )}
                {settings.guides && phase === "ready" ? (
                  <>
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-guide-top bg-stage/35" />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-guide-bottom bg-stage/35" />
                  </>
                ) : null}
                {settings.title.trim() && phase === "ready" ? (
                  <div className="pointer-events-none absolute inset-x-title-x top-title-y text-ivory">
                    <div className="mb-2 h-0.5 w-8 bg-brass" />
                    <p className="text-sm font-medium leading-snug">{settings.title.trim()}</p>
                  </div>
                ) : null}
                {phase === "ready" ? (
                  <button
                    type="button"
                    onClick={toggleReel}
                    aria-label={reelPlaying ? "Pausa anteprima" : "Anteprima dello short"}
                    className="absolute bottom-3 left-3 flex size-11 items-center justify-center rounded-full bg-ivory text-ink"
                  >
                    {reelPlaying ? <Pause className="size-5" /> : <Play className="size-5 translate-x-px" />}
                  </button>
                ) : null}
              </div>

              <button
                type="button"
                className="btn btn-ink mt-4 w-full"
                disabled={!active || !!exporting || phase !== "ready"}
                onClick={() => {
                  if (!active) return;
                  const index = Math.max(0, clips.findIndex((clip) => clip.id === active.id));
                  void download(active, index);
                }}
              >
                <Download className="size-4" />
                {exporting
                  ? `Esportazione ${Math.round(exporting.progress * 100)}%`
                  : active
                    ? `Scarica · ${formatClock(active.end - active.start)}`
                    : "Scarica lo short"}
              </button>
              {exporting ? (
                <button type="button" className="btn btn-line mt-2 w-full" onClick={() => exportAbort.current?.abort()}>
                  Annulla esportazione
                </button>
              ) : null}
              {clips.length > 1 ? (
                <button
                  type="button"
                  className="btn btn-line mt-2 w-full"
                  disabled={!!exporting || phase !== "ready"}
                  onClick={() => void downloadAll()}
                >
                  Scarica tutti
                </button>
              ) : null}
              <p className="mt-3 text-sm leading-relaxed text-ink/60">
                L'esportazione avviene in tempo reale: uno short da {settings.durationSec}s chiede circa{" "}
                {settings.durationSec} secondi. Il file resta sul dispositivo, pronto per Shorts, Reel o TikTok.
              </p>

              <div className="mt-6 rounded-2xl bg-sheet p-4 ring-1 ring-ink/10">
                <p className="text-sm font-medium">Impostazione predefinita</p>
                <p className="mt-1 text-sm leading-relaxed text-ink/65">
                  60 secondi, verticale 9:16, senza titolo e senza effetti. Solo un taglio pulito, con una breve dissolvenza.
                </p>

                <Field label="Durata" hint={`${settings.durationSec}s`}>
                  <div className="flex flex-wrap gap-2">
                    {[15, 30, 60, 90].map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="seg"
                        data-on={settings.durationSec === value}
                        onClick={() => update({ durationSec: value })}
                      >
                        {value}s
                      </button>
                    ))}
                  </div>
                  <Slider.Root
                    min={10}
                    max={90}
                    step={1}
                    value={[settings.durationSec]}
                    onValueChange={([value]) => update({ durationSec: value ?? 60 })}
                    aria-label="Durata dello short in secondi"
                    className="relative mt-3 flex h-11 w-full touch-none items-center"
                  >
                    <Slider.Track className="relative h-1 grow rounded-full bg-ink/15">
                      <Slider.Range className="absolute h-full rounded-full bg-brass" />
                    </Slider.Track>
                    <Slider.Thumb className="block size-5 rounded-full bg-ink" />
                  </Slider.Root>
                </Field>

                <Field label="Quanti tagli" hint={settings.countMode === "auto" ? "Solo i più forti" : "Fissi"}>
                  <div className="flex flex-wrap gap-2">
                    {counts.map((value) => (
                      <button
                        key={String(value)}
                        type="button"
                        className="seg"
                        data-on={settings.countMode === value}
                        onClick={() => update({ countMode: value })}
                      >
                        {value === "auto" ? "Auto" : value}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="Formato">
                  <div className="flex flex-wrap gap-2">
                    {aspects.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="seg"
                        data-on={settings.aspect === value}
                        onClick={() => update({ aspect: value })}
                      >
                        {aspectLabel(value)}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="Fuoco dell'inquadratura" hint={wide ? "Video orizzontale" : "Centro"}>
                  <p className="mb-2 text-sm text-ink/55">Orizzontale · {Math.round(settings.focusX * 100)}%</p>
                  <Slider.Root
                    min={0}
                    max={1}
                    step={0.01}
                    value={[settings.focusX]}
                    onValueChange={([value]) => update({ focusX: value ?? 0.5 })}
                    aria-label="Fuoco orizzontale"
                    className="relative flex h-11 w-full touch-none items-center"
                  >
                    <Slider.Track className="relative h-1 grow rounded-full bg-ink/15">
                      <Slider.Range className="absolute h-full rounded-full bg-brass" />
                    </Slider.Track>
                    <Slider.Thumb className="block size-5 rounded-full bg-ink" />
                  </Slider.Root>
                  <p className="mb-2 mt-2 text-sm text-ink/55">Verticale · {Math.round(settings.focusY * 100)}%</p>
                  <Slider.Root
                    min={0}
                    max={1}
                    step={0.01}
                    value={[settings.focusY]}
                    onValueChange={([value]) => update({ focusY: value ?? 0.42 })}
                    aria-label="Fuoco verticale"
                    className="relative flex h-11 w-full touch-none items-center"
                  >
                    <Slider.Track className="relative h-1 grow rounded-full bg-ink/15">
                      <Slider.Range className="absolute h-full rounded-full bg-brass" />
                    </Slider.Track>
                    <Slider.Thumb className="block size-5 rounded-full bg-ink" />
                  </Slider.Root>
                  {wide ? (
                    <p className="mt-2 text-sm leading-relaxed text-ink/60">
                      Lo short ritaglia il fotogramma. Sposta il fuoco se il soggetto non è al centro.
                    </p>
                  ) : null}
                </Field>

                <Field label="Titolo in quadro" hint="Opzionale">
                  <input
                    value={settings.title}
                    maxLength={80}
                    placeholder="Vuoto: nessuno testo"
                    onChange={(event) => update({ title: event.target.value })}
                    className="h-11 w-full rounded-full bg-paper px-4 text-sm ring-1 ring-ink/15"
                  />
                </Field>

                <Field label="Finitura">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="seg" data-on={settings.fade} onClick={() => update({ fade: !settings.fade })}>
                      Dissolvenza
                    </button>
                    <button
                      type="button"
                      className="seg"
                      data-on={settings.guides}
                      onClick={() => update({ guides: !settings.guides })}
                    >
                      Zone sicure
                    </button>
                    {qualities.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="seg"
                        data-on={settings.quality === value}
                        onClick={() => update({ quality: value })}
                      >
                        {value}p
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            </aside>
          </div>
        )}

        <footer className="mt-12 border-t border-ink/10 pt-6 text-sm leading-relaxed text-ink/55">
          I file che carichi restano nel browser e non vengono inviati a un server. I link YouTube passano da un
          server solo per scaricare il video. Instagram, TikTok e Vimeo non sono supportati; un file o un URL
          diretto sì.
        </footer>
      </main>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">{label}</p>
        {hint ? <p className="text-sm text-ink/50">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

function Intake({
  link,
  over,
  onLink,
  onSubmit,
  grab,
  onCancelGrab,
  onFile,
  onDemo,
  onBrowse,
  onOver,
  fileRef,
}: {
  link: string;
  over: boolean;
  onLink: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  grab: GrabProgress | null;
  onCancelGrab: () => void;
  onFile: (file: File) => void;
  onDemo: () => void;
  onBrowse: () => void;
  onOver: (value: boolean) => void;
  fileRef: RefObject<HTMLInputElement | null>;
}) {
  const pct =
    grab && grab.total ? Math.min(100, Math.round((grab.loaded / grab.total) * 100)) : null;

  return (
    <div>
      <h1 className="max-w-xl font-display text-4xl leading-tight tracking-tight sm:text-5xl">
        I momenti che contano, in un minuto.
      </h1>
      <p className="mt-4 max-w-xl text-base leading-relaxed text-ink/70">
        Carica un video o incolla un link, anche di YouTube. Corto individua i passaggi più pieni e li consegna in shorts da
        60 secondi, verticali e senza effetti.
      </p>

      <div
        className={`mt-8 rounded-3xl bg-sheet px-5 py-8 ring-1 sm:px-8 ${over ? "ring-brass" : "ring-ink/10"}`}
        onDragOver={(event) => {
          event.preventDefault();
          onOver(true);
        }}
        onDragLeave={() => onOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          onOver(false);
          const file = event.dataTransfer.files[0];
          if (file) onFile(file);
        }}
      >
        <p className="font-display text-3xl tracking-tight">Porta un video</p>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-ink/65">
          Trascinalo qui, oppure scegli un file mp4, webm o mov. Non lascia questo dispositivo.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" className="btn btn-ink" onClick={onBrowse}>
            Scegli un file
          </button>
          <button type="button" className="btn btn-line" onClick={onDemo}>
            Video dimostrativo
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,video/*"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onFile(file);
          }}
        />

        <form onSubmit={onSubmit} className="mt-8">
          <label htmlFor="video-link" className="text-sm font-medium">
            Link al video
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="video-link"
              value={link}
              inputMode="url"
              disabled={grab !== null}
              placeholder="Link YouTube o https://…/filmato.mp4"
              onChange={(event) => onLink(event.target.value)}
              className="h-11 min-w-0 flex-1 rounded-full bg-paper px-4 text-sm ring-1 ring-ink/15 disabled:opacity-60"
            />
            {grab ? (
              <button type="button" className="btn btn-line" onClick={onCancelGrab}>
                Annulla
              </button>
            ) : (
              <button type="submit" className="btn btn-line">
                Apri
              </button>
            )}
          </div>
          {grab ? (
            <div className="mt-3">
              <div
                role="progressbar"
                aria-label="Download del video"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct ?? undefined}
                className="h-1.5 overflow-hidden rounded-full bg-ink/10"
              >
                <div
                  className={`h-full rounded-full bg-ink transition-[width] ${
                    pct === null ? "w-1/3 animate-pulse motion-reduce:animate-none" : ""
                  }`}
                  style={pct === null ? undefined : { width: `${pct}%` }}
                />
              </div>
              <p aria-live="polite" className="mt-1.5 text-sm text-ink/65">
                {pct !== null && grab.total
                  ? `Scarico il video: ${pct}% (${megabytes(grab.loaded)} di ${megabytes(grab.total)} MB)`
                  : `Scarico il video: ${megabytes(grab.loaded)} MB`}
              </p>
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
