import { beforeEach, describe, expect, it, vi } from 'vitest';

const ask = vi.fn<(o: unknown) => Promise<boolean>>();
const copyText = vi.fn<(text: string, label: string) => Promise<void>>(async () => {});
vi.mock('./Dialog', () => ({ ask: (o: unknown) => ask(o) }));
vi.mock('./ui', () => ({ copyText: (text: string, label: string) => copyText(text, label) }));

const { askReload } = await import('./staleReload');

describe('askReload', () => {
  beforeEach(() => { ask.mockReset(); copyText.mockClear(); });

  it('no: false, nothing copied', async () => {
    ask.mockResolvedValue(false);
    expect(await askReload('mon brouillon')).toBe(false);
    expect(copyText).not.toHaveBeenCalled();
  });

  it('yes with a draft: the draft is copied, true', async () => {
    ask.mockResolvedValue(true);
    expect(await askReload('mon brouillon')).toBe(true);
    expect(copyText).toHaveBeenCalledWith('mon brouillon', expect.any(String));
  });

  it('yes without a draft: no copy', async () => {
    ask.mockResolvedValue(true);
    expect(await askReload(null)).toBe(true);
    expect(copyText).not.toHaveBeenCalled();
  });
});
