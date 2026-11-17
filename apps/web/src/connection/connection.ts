// Connection state of the web client: Intendia server unreachable (with its probe), offline browser, and the
// "Session expired" dialog. The only module with global state of this kind; nothing runs at import:
// `initConnection()` is called once by main.tsx.
import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { api, ApiError, setCallHooks } from '../api';
import { EMBEDDED } from '../chat/embed';
import { flushDrafts } from '../chat/draft';
import { askText, type AskTextOptions } from '../components/Dialog';
import { t } from '../i18n';

export const PROBE_MS = 5000;

interface Deps {
  queryClient: { invalidateQueries: () => unknown };
  router: { invalidate: () => unknown };
  /** Side chat iframe: no probe, no dialog (the page around it shows both). */
  embedded?: boolean;
  // seams for the tests
  askText?: (o: AskTextOptions) => Promise<string | null>;
  login?: (password: string) => Promise<unknown>;
  fetch?: typeof fetch;
}

let serverDown = false;
let probe: ReturnType<typeof setInterval> | null = null;
let relogin = false;
const listeners = new Set<() => void>();

function notify() { for (const l of listeners) l(); }

/** Wires `call()` to this module. Calling it again starts from a clean state (tests). */
export function initConnection(deps: Deps): void {
  const { queryClient, router } = deps;
  const embedded = deps.embedded ?? EMBEDDED;
  const ask = deps.askText ?? askText;
  const login = deps.login ?? api.login;
  const get = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  if (probe) clearInterval(probe);
  probe = null;
  serverDown = false;
  relogin = false;
  notify();

  const writeTimeout = () => { void queryClient.invalidateQueries(); };
  if (embedded) {
    setCallHooks({ network: () => {}, unauthenticated: () => {}, writeTimeout });
    return;
  }

  const network = (ok: boolean) => {
    if (!ok) {
      if (serverDown) return;
      serverDown = true;
      notify();
      probe = setInterval(probeOnce, PROBE_MS);
      return;
    }
    if (!serverDown) return;
    serverDown = false;
    if (probe) clearInterval(probe);
    probe = null;
    notify();
    void queryClient.invalidateQueries();
  };
  const probeOnce = () => {
    get('/x/health', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: unknown) => { if (d && typeof d === 'object' && (d as { ok?: unknown }).ok === true) network(true); })
      .catch(() => {});
  };

  const unauthenticated = () => {
    if (relogin) return;
    relogin = true;
    void (async () => {
      let message = t('Saisissez le mot de passe pour continuer : cette page et vos modifications restent.');
      for (;;) {
        const password = await ask({ title: t('Session expirée'), message, confirmLabel: t('Se reconnecter'), password: true });
        if (password === null) {
          relogin = false;
          flushDrafts();
          void router.invalidate();
          return;
        }
        try {
          await login(password);
          relogin = false;
          void queryClient.invalidateQueries();
          return;
        } catch (err) {
          message = err instanceof ApiError ? err.message : String(err);
        }
      }
    })();
  };

  setCallHooks({ network, unauthenticated, writeTimeout });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  const off = onlineManager.subscribe(l);
  return () => { listeners.delete(l); off(); };
}

let snap = { offline: false, serverDown: false };
function snapshot() {
  const offline = !onlineManager.isOnline();
  if (snap.offline !== offline || snap.serverDown !== serverDown) snap = { offline, serverDown };
  return snap;
}

/** Offline browser (TanStack Query's onlineManager) and Intendia server unreachable. */
export function useConnection(): { offline: boolean; serverDown: boolean } {
  return useSyncExternalStore(subscribe, snapshot);
}

/** Tests: current state without React. */
export function connectionState() { return snapshot(); }
