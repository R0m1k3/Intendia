/** Reads the start of a file: at most `max` bytes, `cut` when there was more. */
export async function readHead(url: string, max: number): Promise<{ text: string; cut: boolean }> {
  const bytes = await readBytes(url, max, 'cut');
  return { text: new TextDecoder().decode(bytes.data), cut: bytes.cut };
}

export class TooBigError extends Error {}

/**
 * The bytes of a file. `over`: `cut` keeps the first `max` bytes, `fail` throws TooBigError (checked on
 * Content-Length first, then on the bytes read).
 */
export async function readBytes(url: string, max: number, over: 'cut' | 'fail'): Promise<{ data: Uint8Array; cut: boolean }> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok || !res.body) throw new Error(res.status === 404 ? 'Fichier introuvable' : `HTTP ${res.status}`);
  const announced = Number(res.headers.get('content-length') ?? NaN);
  if (over === 'fail' && announced > max) {
    void res.body.cancel();
    throw new TooBigError('Trop gros pour un aperçu : téléchargez-le');
  }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  let cut = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.length > max) {
      if (over === 'fail') {
        void reader.cancel();
        throw new TooBigError('Trop gros pour un aperçu : téléchargez-le');
      }
      parts.push(value.subarray(0, max - size));
      size = max;
      cut = true;
      void reader.cancel();
      break;
    }
    parts.push(value);
    size += value.length;
  }
  const data = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { data.set(p, at); at += p.length; }
  return { data, cut };
}
