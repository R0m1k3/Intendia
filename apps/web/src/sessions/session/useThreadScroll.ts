// Scrolling of the thread: following its end while it grows unless the reader scrolled up (chat/follow.ts), and
// moving between the user's questions (« Plan », ↑ ↓, Alt+↑/↓).
import { useEffect, useMemo, useRef } from 'react';
import type { Approval, Clarify, Entry } from '../../chat/events';
import { GESTURE_MS, measure, startFollow, type FollowState } from '../../chat/follow';
import { outline } from '../../chat/turns';
import { t } from '../../i18n';

export function useThreadScroll({ entries, approval, clarify, inactive: isInactive }: {
  entries: Entry[];
  approval: Approval | null;
  clarify: Clarify | null;
  /** a column of the Chat page that is not the active one: the keys are not for it */
  inactive: boolean;
}) {
  // Follow the bottom of the thread while it grows (new turns, streamed text, images that load), unless the reader
  // scrolled up. `measure` (chat/follow.ts) judges from the scroll position, measured on each scroll event and again
  // just before each automatic scroll: a scroll event comes one frame late, after a burst of text may have landed, and
  // must not be read as the reader leaving the bottom. The page opens at the bottom.
  const bottom = useRef<HTMLDivElement>(null);
  const follow = useRef<FollowState>({ pinned: true, lastTop: 0, lastHeight: 0 });
  // time of the reader's last gesture that can scroll up: only such a move leaves the end of the thread
  const gesture = useRef(0);
  const byReader = () => Date.now() - gesture.current < GESTURE_MS;
  // the element that scrolls the thread: the page's <main>, or the column of the Chat page
  const box = () => bottom.current?.closest<HTMLElement>('[data-scroll-root]') ?? null;
  // to the very end of the page: the composer sticks below the thread, the last turn must sit above it
  // While the thread follows its end, the browser must not "keep the reading position" on its own (scroll
  // anchoring): a turn that changes height above (its buttons leave when a run starts) would move the position up by a
  // few pixels, which reads as the reader leaving the bottom, and the answer would arrive off screen. Once the
  // reader has scrolled up, anchoring is wanted again (turns far above take their real height as they come near).
  const track = (main: HTMLElement, next: FollowState) => {
    follow.current = next;
    main.style.overflowAnchor = next.pinned ? 'none' : '';
  };
  const toEnd = (main: HTMLElement) => {
    main.scrollTop = main.scrollHeight;
    track(main, { pinned: true, lastTop: main.scrollTop, lastHeight: main.scrollHeight });
  };
  const followIfPinned = () => {
    const main = box();
    if (!main) return;
    track(main, measure(follow.current, main, byReader()));
    if (follow.current.pinned) toEnd(main);
  };
  const tail = entries.length + (entries.at(-1) && 'text' in entries.at(-1)! ? (entries.at(-1) as { text: string }).text.length : 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: dependencies chosen on purpose (see the comment of this hook)
  useEffect(() => {
    const main = box();
    const thread = bottom.current?.parentElement;
    if (!main || !thread) return;
    track(main, startFollow(main));
    const onScroll = () => track(main, measure(follow.current, main, byReader()));
    const mark = () => { gesture.current = Date.now(); };
    const onWheel = (e: WheelEvent) => { if (e.deltaY < 0) mark(); };
    const onKey = (e: KeyboardEvent) => {
      // keys that scroll up, outside a field (in the message field they move the caret)
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement || target?.isContentEditable) return;
      if (['ArrowUp', 'PageUp', 'Home'].includes(e.key) || (e.key === ' ' && e.shiftKey)) mark();
    };
    // the scrollbar: a press on the scrolling element itself (not on its content)
    const onPointer = (e: PointerEvent) => { if (e.target === main) mark(); };
    // the thread and what sits under it (the composer grows with a queued message, files, a card)
    const grow = new ResizeObserver(followIfPinned);
    grow.observe(thread);
    if (thread.parentElement) grow.observe(thread.parentElement);
    main.addEventListener('scroll', onScroll, { passive: true });
    main.addEventListener('wheel', onWheel, { passive: true });
    main.addEventListener('touchmove', mark, { passive: true });
    main.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      grow.disconnect();
      main.removeEventListener('scroll', onScroll);
      main.removeEventListener('wheel', onWheel);
      main.removeEventListener('touchmove', mark);
      main.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
      main.style.overflowAnchor = '';
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: dependencies chosen on purpose (see the comment of this hook)
  useEffect(followIfPinned, [tail, approval, clarify]);

  const items = useMemo(() => outline(entries), [entries]);
  const header = useRef<HTMLElement>(null);
  const turnEl = (key: string) => box()?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) ?? null;
  const jumpTo = (key: string) => {
    const main = box();
    const el = turnEl(key);
    if (!main || !el) return;
    // asked by the reader (« Plan », ↑ ↓): leaving the end is wanted
    gesture.current = Date.now();
    const head = header.current?.getBoundingClientRect().height ?? 0;
    main.scrollTop += el.getBoundingClientRect().top - main.getBoundingClientRect().top - head - 8;
    el.classList.add('ring-2', 'ring-accent');
    setTimeout(() => el.classList.remove('ring-2', 'ring-accent'), 1200);
  };
  /** Index of the current question: the last one whose top has reached the top of the view (under the header). */
  const currentTurn = (): number => {
    const main = box();
    if (!main) return -1;
    const line = main.getBoundingClientRect().top + (header.current?.getBoundingClientRect().height ?? 0) + 24;
    let at = -1;
    items.forEach((it, i) => { const el = turnEl(it.key); if (el && el.getBoundingClientRect().top <= line) at = i; });
    return at;
  };
  const jump = (dir: -1 | 1) => {
    if (!items.length) return;
    const at = currentTurn();
    if (dir === 1) { const next = items[at + 1]; if (next) jumpTo(next.key); return; }
    if (at < 0) return;
    // ↑ goes back to the top of the current question when the reader went down its turn, else to the previous one
    const main = box()!;
    const el = turnEl(items[at]!.key);
    const top = main.getBoundingClientRect().top + (header.current?.getBoundingClientRect().height ?? 0);
    const inside = el ? el.getBoundingClientRect().top < top - 4 : false;
    const target = inside ? items[at] : items[at - 1];
    if (target) jumpTo(target.key);
  };
  const jumpRef = useRef(jump);
  const inactive = useRef(false);
  inactive.current = isInactive;
  jumpRef.current = jump;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // several columns on the Chat page: the active one only
      if (inactive.current) return;
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
        // in the message field only, and only when the caret is at the edge it moves towards (or the field is empty)
        if (target.getAttribute('aria-label') !== t('Message')) return;
        const { selectionStart: a, selectionEnd: b, value } = target;
        const edge = value === '' || (a === b && (e.key === 'ArrowUp' ? a === 0 : a === value.length));
        if (!edge) return;
      } else if (target?.isContentEditable) return;
      e.preventDefault();
      jumpRef.current(e.key === 'ArrowUp' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return { bottom, header, box, toEnd, items, jumpTo, jump };
}
