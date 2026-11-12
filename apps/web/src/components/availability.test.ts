import { describe, expect, it } from 'vitest';
import type { CompatReport } from '../api';
import { availability, compatPoll } from './availability';

function report(extra: Partial<CompatReport> = {}): CompatReport {
  return {
    instanceId: 'fake', checkedAt: 0, hermesVersion: '0.23.0',
    api: { reachable: true }, dash: { configured: true, reachable: true, openapi: true },
    modules: [{
      id: 'config', label: 'Configuration', state: 'readonly', reasons: [], dashboardLink: 'http://dash/config',
      ops: { read: { ok: true, notes: [] }, oauthStart: { ok: false, notes: ['dashboard POST /api/providers/oauth : 404'] } },
    }],
    ...extra,
  } as CompatReport;
}

describe('availability', () => {
  it('an op the report does not know yet is pending, not missing', () => {
    const a = availability(report({ unchecked: ['config.oauthList'] }), 'config', [['config', 'read']], [['config', 'oauthList', 'Abonnements']], true);
    expect(a.missing).toEqual([]);
    expect(a.reasons).toEqual([]);
    expect(a.pending).toBe(true);
    expect(a.has('config', 'oauthList')).toBe(false);
    expect(a.link).toBe('http://dash/config');
  });

  it('an op that really failed stays missing, with its note', () => {
    const a = availability(report(), 'config', [['config', 'read']], [['config', 'oauthStart', 'Connecter un abonnement']], true);
    expect(a.missing).toEqual(['Connecter un abonnement']);
    expect(a.reasons).toEqual(['dashboard POST /api/providers/oauth : 404']);
    expect(a.pending).toBe(false);
  });

  it('a required op not checked yet does not block the page; the failed check is given', () => {
    const a = availability(report({ unchecked: ['config.guard'], checkError: 'boom' }), 'config', [['config', 'guard']], []);
    expect(a.available).toBe(true);
    expect(a.pending).toBe(true);
    expect(a.checkError).toBe('boom');
  });

  it('polls fast only while a check runs', () => {
    expect(compatPoll(report())).toBe(false);
    expect(compatPoll(report({ unchecked: ['config.x'], checking: true }))).toBe(3000);
    expect(compatPoll(report({ unchecked: ['config.x'] }))).toBe(30_000);
  });
});
