import { useQuery } from '@tanstack/react-query';
import { api, type PublicSystemStats } from '../api';
import { ErrorText, Panel } from '../components/ui';
import { formatBytes, formatPercent, formatUptime } from './format';

const POLL_MS = 10_000;

function Gauge({ label, percent, detail }: { label: string; percent: number | null; detail: string }) {
  const p = percent === null ? null : Math.max(0, Math.min(100, percent));
  return (
    <div className="card px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] text-ink-faint">{label}</p>
        <p className="font-mono text-[18px] font-semibold">{formatPercent(percent)}</p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p ?? undefined}>
        {p !== null && <div className="h-full rounded-full bg-ink-soft" style={{ width: `${p}%` }} />}
      </div>
      <p className="mt-1.5 font-mono text-xs text-ink-faint">{detail}</p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | null }) {
  return <div className="flex gap-3 px-4 py-2 text-sm"><dt className="w-44 shrink-0 text-ink-faint">{k}</dt><dd className="min-w-0 break-words font-mono text-[13px]">{v ?? '—'}</dd></div>;
}

function Body({ s }: { s: PublicSystemStats }) {
  return (
    <div className="space-y-5">
      {!s.psutil && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">psutil absent chez Hermes : métriques limitées (identité et charge).</p>}
      {s.psutil && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Gauge label="Processeur" percent={s.cpuPercent} detail={s.cpuCount ? `${s.cpuCount} cœurs` : '—'} />
          <Gauge label="Mémoire" percent={s.memory?.percent ?? null} detail={`${formatBytes(s.memory?.used)} / ${formatBytes(s.memory?.total)}`} />
          <Gauge label="Disque (home Hermes)" percent={s.disk?.percent ?? null} detail={`${formatBytes(s.disk?.used)} / ${formatBytes(s.disk?.total)}`} />
        </div>
      )}
      <Panel title="Machine" bodyClassName="border-t border-line/70">
        <dl className="divide-y divide-line/70">
          <Row k="Nom d’hôte" v={s.hostname} />
          <Row k="Système" v={[s.system, s.release, s.arch].filter(Boolean).join(' · ') || null} />
          <Row k="Charge (1, 5, 15 min)" v={s.loadAvg ? s.loadAvg.map((x) => x.toFixed(2)).join('  ') : null} />
          <Row k="Démarrée depuis" v={s.uptimeSeconds === null ? null : formatUptime(s.uptimeSeconds)} />
          <Row k="Hermes" v={s.hermesVersion} />
          <Row k="Python" v={s.pythonVersion} />
          {s.process && <Row k="Processus du dashboard" v={`${formatBytes(s.process.rss)} · ${s.process.threads ?? '—'} threads`} />}
        </dl>
      </Panel>
      <p className="text-xs text-ink-faint">En conteneur, mémoire et processeur sont ceux de la machine hôte, pas les limites du conteneur.</p>
    </div>
  );
}

export function System({ inst }: { inst: string }) {
  const q = useQuery({ queryKey: ['monitor', inst, 'system'], queryFn: () => api.monitorSystem(inst), refetchInterval: POLL_MS, refetchIntervalInBackground: false });
  return (
    <div className="space-y-4">
      <ErrorText error={q.error} />
      {q.isPending && <p className="text-sm text-ink-faint">Chargement…</p>}
      {q.data && <Body s={q.data} />}
    </div>
  );
}
