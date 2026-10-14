import { createFileRoute } from "@tanstack/react-router";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_BYTES = 300 * 1024 * 1024; // limite di sicurezza: 300 MB
const MAX_REDIRECTS = 5;
const HEADERS_TIMEOUT_MS = 20_000;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

class GrabError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function json(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/* ---------- protezione SSRF: mai verso reti interne ---------- */

function isPrivateIPv4(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateIPv6(ip: string) {
  const v = ip.toLowerCase();
  return (
    v === "::" ||
    v === "::1" ||
    v.startsWith("::ffff:") || // IPv4-mapped: meglio rifiutare
    v.startsWith("fc") ||
    v.startsWith("fd") ||
    /^fe[89ab]/.test(v)
  );
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new GrabError("URL non valido");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new GrabError("Sono supportati solo URL http(s)");
  }
  if (url.username || url.password) {
    throw new GrabError("URL con credenziali non consentito");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addrs: { address: string; family: number }[];
  try {
    addrs = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await lookup(host, { all: true });
  } catch {
    throw new GrabError("Host non raggiungibile", 502);
  }
  const blocked =
    addrs.length === 0 ||
    addrs.some((a) =>
      a.family === 4 ? isPrivateIPv4(a.address) : isPrivateIPv6(a.address),
    );
  if (blocked) throw new GrabError("Indirizzo non consentito", 403);
  return url;
}

/* ---------- YouTube: risoluzione tramite servizio esterno ---------- */

function isYouTube(url: URL) {
  return YOUTUBE_HOSTS.has(url.hostname.toLowerCase());
}

/**
 * Chiede a un'istanza Cobalt-compatibile (YT_RESOLVER_URL) l'URL diretto
 * del file. Funziona dove yt-dlp/ytdl-core non possono girare (Vercel).
 */
async function resolveYouTube(
  url: string,
): Promise<{ url: string; filename?: string }> {
  const base = process.env.YT_RESOLVER_URL;
  if (!base) {
    console.warn("[grab] YT_RESOLVER_URL non impostata: download YouTube disattivato");
    throw new GrabError("Il download da YouTube non è attivo su questo server.", 501);
  }
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (process.env.YT_RESOLVER_KEY) {
    headers.authorization = `Api-Key ${process.env.YT_RESOLVER_KEY}`;
  }

  let data: any;
  try {
    const res = await fetch(base, {
      method: "POST",
      headers,
      body: JSON.stringify({ url, videoQuality: "720", downloadMode: "auto" }),
      signal: AbortSignal.timeout(HEADERS_TIMEOUT_MS),
    });
    data = await res.json();
    if (!res.ok && !data?.error) throw new Error(String(res.status));
  } catch {
    throw new GrabError("Il servizio di estrazione non ha risposto", 502);
  }

  if (
    (data.status === "tunnel" || data.status === "redirect") &&
    typeof data.url === "string"
  ) {
    return { url: data.url, filename: data.filename };
  }
  if (data.status === "picker" && Array.isArray(data.picker)) {
    const v = data.picker.find((p: any) => p?.type === "video" && p?.url);
    if (v) return { url: v.url };
  }
  throw new GrabError(
    `Impossibile ottenere il video (${data?.error?.code ?? data?.status ?? "errore"})`,
    502,
  );
}

/* ---------- download in streaming ---------- */

const ALLOWED_TYPES = (t: string) =>
  t.startsWith("video/") ||
  t === "application/octet-stream" ||
  t === "binary/octet-stream" ||
  t === "application/mp4";

function filenameFrom(url: URL, fallback?: string) {
  if (fallback) return fallback;
  const last = decodeURIComponent(url.pathname.split("/").pop() ?? "");
  return /\.[a-z0-9]{2,4}$/i.test(last) ? last : "video.mp4";
}

async function proxyVideo(
  start: URL,
  trustedFirstHop: boolean,
  filename: string | undefined,
  clientSignal: AbortSignal,
) {
  const ctrl = new AbortController();
  clientSignal.addEventListener("abort", () => ctrl.abort(), { once: true });

  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(trustedFirstHop && hop === 0)) await assertPublicUrl(current.href);

    // il timeout vale solo fino agli header, non per il corpo (file grandi)
    const timer = setTimeout(() => ctrl.abort(), HEADERS_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; ShortmasterGrabber/1.0)",
          accept: "video/*,*/*;q=0.8",
        },
      });
    } catch {
      throw new GrabError("Impossibile scaricare il file", 502);
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new GrabError("Redirect non valido", 502);
      current = new URL(loc, current);
      await res.body?.cancel();
      continue;
    }
    if (!res.ok || !res.body) {
      throw new GrabError(`Il server remoto ha risposto ${res.status}`, 502);
    }

    const type = (res.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!ALLOWED_TYPES(type)) {
      await res.body.cancel();
      throw new GrabError(
        "L'URL non punta a un file video diretto (pagina web o formato non supportato).",
        415,
      );
    }

    const len = Number(res.headers.get("content-length"));
    if (Number.isFinite(len) && len > MAX_BYTES) {
      await res.body.cancel();
      throw new GrabError("Il video supera il limite di 300 MB", 413);
    }

    let seen = 0;
    const limiter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > MAX_BYTES) {
          controller.error(new Error("Limite di dimensione superato"));
          ctrl.abort();
          return;
        }
        controller.enqueue(chunk);
      },
    });

    const out = new Headers({
      "content-type": type || "video/mp4",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-grab-filename": encodeURIComponent(filenameFrom(current, filename)),
    });
    if (Number.isFinite(len) && len > 0) out.set("content-length", String(len));

    return new Response(res.body.pipeThrough(limiter), { status: 200, headers: out });
  }
  throw new GrabError("Troppi redirect", 502);
}

/* ---------- route ---------- */

export const Route = createFileRoute("/api/grab")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const raw = new URL(request.url).searchParams.get("url")?.trim();
        if (!raw) return json(400, "Parametro url mancante");

        try {
          const target = await assertPublicUrl(raw);

          if (isYouTube(target)) {
            const r = await resolveYouTube(target.href);
            return await proxyVideo(new URL(r.url), true, r.filename, request.signal);
          }
          return await proxyVideo(target, false, undefined, request.signal);
        } catch (e) {
          if (e instanceof GrabError) return json(e.status, e.message);
          console.error("[grab]", e);
          return json(502, "Download non riuscito");
        }
      },
    },
  },
});
