import type { Page } from '@playwright/test';

declare global {
  interface Window { __autoConfirm?: () => Promise<boolean>; __autoConfirmOn?: boolean }
}

/**
 * Answers Intendia's in-app confirmations ([role=alertdialog], `ask()` of components/Dialog.tsx).
 * `answer(n)`: true = confirm, false = cancel (n = 1, 2, … per page).
 */
export async function autoConfirm(page: Page, answer: (n: number) => boolean = () => true): Promise<void> {
  let n = 0;
  await page.exposeFunction('__autoConfirm', () => answer(++n));
  const watch = () => {
    if (window.__autoConfirmOn) return;
    window.__autoConfirmOn = true;
    const scan = async () => {
      const d = document.querySelector('[role=alertdialog]:not([data-auto])');
      if (!d) return;
      d.setAttribute('data-auto', '1');
      const yes = await window.__autoConfirm!();
      d.querySelector<HTMLButtonElement>(yes ? 'button[type=submit]' : 'button[type=button]')?.click();
    };
    new MutationObserver(() => void scan()).observe(document, { childList: true, subtree: true });
  };
  await page.addInitScript(watch);
  await page.evaluate(watch).catch(() => {});
}
