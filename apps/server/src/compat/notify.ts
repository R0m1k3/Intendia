import type { CompatReport, ModuleState } from '../connectors/types.js';

export interface StateChange {
  module: string;
  label: string;
  from: ModuleState | null;
  to: ModuleState;
  reasons: string[];
}

export interface Notifier {
  moduleStates(report: CompatReport, changes: StateChange[]): Promise<void>;
}

const STATE_FR: Record<ModuleState, string> = { full: 'complet', readonly: 'lecture seule', unavailable: 'indisponible' };

/**
 * Generic webhook: POST JSON with a ready-to-send `text` (works as-is with ntfy, Discord-style
 * relays, n8n...). No webhook configured: changes are only logged.
 */
export class WebhookNotifier implements Notifier {
  constructor(private readonly url: string | undefined, private readonly publicUrl: string | undefined) {}

  async moduleStates(report: CompatReport, changes: StateChange[]): Promise<void> {
    const lines = changes.map((c) => `• ${c.label} : ${c.from ? STATE_FR[c.from] : 'nouveau'} → ${STATE_FR[c.to]}${c.reasons[0] ? ` (${c.reasons[0]})` : ''}`);
    const text = `Intendia — instance ${report.instanceId} (Hermes ${report.hermesVersion ?? '?'})\n${lines.join('\n')}`;
    console.log(`[compat] ${text.replace(/\n/g, ' | ')}`);
    if (!this.url) return;
    try {
      await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          instance: report.instanceId,
          hermesVersion: report.hermesVersion,
          changes,
          link: this.publicUrl ? `${this.publicUrl}/etat` : undefined,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      console.warn(`[compat] webhook failed: ${(err as Error).message}`);
    }
  }
}
