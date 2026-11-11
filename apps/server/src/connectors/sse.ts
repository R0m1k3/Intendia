/** One SSE frame: its `id:` line (Hermes' `seq`) and its parsed `data:` JSON. */
export interface SseFrame { id: string | null; data: any }

/**
 * Reads an SSE body into frames; stops at the end of the stream, after `maxMs`, or `idleMs` after the last chunk
 * (a stream that stays open, like the events of a run waiting for approval). Comment frames (`: …`) and frames
 * whose data is not JSON are skipped.
 */
export async function readSseFrames(res: Response, { maxMs = 2000, idleMs }: { maxMs?: number; idleMs?: number } = {}): Promise<SseFrame[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const wait = Math.max(1, Math.min(deadline - Date.now(), idleMs !== undefined && buf ? idleMs : Number.POSITIVE_INFINITY));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((r) => { timer = setTimeout(() => r({ done: true, value: undefined }), wait); }),
    ]);
    clearTimeout(timer);
    if (chunk.done) break;
    buf += dec.decode(chunk.value, { stream: true });
  }
  await reader.cancel().catch(() => {});
  const frames: SseFrame[] = [];
  for (const f of buf.split(/\r?\n\r?\n/)) {
    const data = f.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
    if (!data) continue;
    try {
      frames.push({ id: /^id: ?(.*)$/m.exec(f)?.[1] ?? null, data: JSON.parse(data) });
    } catch {
      // not JSON: ignored
    }
  }
  return frames;
}
