export interface GrabProgress {
  loaded: number;
  /** null se il server remoto non dichiara la dimensione */
  total: number | null;
}

/**
 * Scarica un video da un URL (file diretto o YouTube) passando dal server,
 * e lo restituisce come File, identico a uno scelto dal disco.
 */
export async function grabVideo(
  url: string,
  opts: { signal?: AbortSignal; onProgress?: (p: GrabProgress) => void } = {},
): Promise<File> {
  const res = await fetch(`/api/grab?url=${encodeURIComponent(url.trim())}`, {
    signal: opts.signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? `Download non riuscito (${res.status})`);
  }
  if (!res.body) throw new Error("Risposta vuota dal server");

  const total = Number(res.headers.get("content-length")) || null;
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let loaded = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as BlobPart);
    loaded += value.byteLength;
    opts.onProgress?.({ loaded, total });
  }

  const type = res.headers.get("content-type")?.split(";")[0] || "video/mp4";
  let name = "video.mp4";
  try {
    name = decodeURIComponent(res.headers.get("x-grab-filename") ?? "") || name;
  } catch {
    /* nome non decodificabile: tengo il default */
  }
  return new File(chunks, name, { type });
}
