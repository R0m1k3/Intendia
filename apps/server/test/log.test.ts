import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatLine, log, logLevel, setLogLevel, setLogSink, withRequest, type LogLevel } from '../src/log.js';
import { testApp } from './helpers.js';

describe('the journal', () => {
  const lines: { level: LogLevel; line: string }[] = [];
  const before = logLevel();
  const prev = setLogSink((level, line) => { lines.push({ level, line }); });
  afterEach(() => { lines.length = 0; setLogLevel(before); });

  it('writes a line with its time and level, and the stack of an error', () => {
    const at = new Date('2026-11-27T19:00:00.000Z');
    expect(formatLine('warn', '[intendia] something', undefined, at, undefined)).toBe('2026-11-27T19:00:00.000Z WARN  [intendia] something');
    expect(formatLine('info', 'ready', undefined, at, 'ab12cd34ef56')).toBe('2026-11-27T19:00:00.000Z INFO  ready req=ab12cd34ef56');
    const text = formatLine('error', 'failed', new Error('boom'), at, undefined);
    expect(text.split('\n')[0]).toBe('2026-11-27T19:00:00.000Z ERROR failed');
    expect(text).toContain('Error: boom');
  });

  it('keeps what is at or above the level', () => {
    setLogLevel('warn');
    log.debug('d'); log.info('i'); log.warn('w'); log.error('e');
    expect(lines.map((l) => l.level)).toEqual(['warn', 'error']);
    setLogLevel('debug');
    log.debug('d');
    expect(lines.at(-1)?.line).toMatch(/ DEBUG d$/);
  });

  it('adds the request to the lines written while it is served, awaited calls included', async () => {
    setLogLevel('info');
    await withRequest('aaaabbbbcccc', async () => {
      await new Promise((r) => setTimeout(r, 1));
      log.info('inside');
    });
    log.info('outside');
    expect(lines[0]?.line).toMatch(/ inside req=aaaabbbbcccc$/);
    expect(lines[1]?.line).toMatch(/ outside$/);
  });

  it('gives each HTTP request an identifier, and one line per request at the debug level only', async () => {
    const t = await testApp();
    setLogLevel('info');
    lines.length = 0;
    const first = await t.app.request('/x/health');
    const second = await t.app.request('/x/health?token=secret-in-the-query');
    const a = first.headers.get('x-request-id');
    const b = second.headers.get('x-request-id');
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(b).toMatch(/^[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
    expect(lines).toEqual([]);

    setLogLevel('debug');
    const third = await t.app.request('/x/health?token=secret-in-the-query');
    const served = lines.filter((l) => l.line.includes('GET /x/health'));
    expect(served).toHaveLength(1);
    expect(served[0]!.line).toContain(`req=${third.headers.get('x-request-id')}`);
    expect(served[0]!.line).toContain(' 200 ');
    expect(served[0]!.line).not.toContain('secret-in-the-query');
  });

  it('an unexpected error: a 500 that names the request, and the stack in the journal under the same identifier', async () => {
    const t = await testApp();
    setLogLevel('info');
    const spy = vi.spyOn(t.services.workspaces as never as { listWorkspaces: () => unknown }, 'listWorkspaces').mockImplementation(() => { throw new Error('disk full'); });
    lines.length = 0;
    const res = await t.request('GET', '/x/workspaces?token=secret-in-the-query');
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(res.json.requestId).toMatch(/^[0-9a-f]{12}$/);
    const failed = lines.filter((l) => l.level === 'error');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.line.split('\n')[0]).toMatch(new RegExp(` ERROR GET /x/workspaces: unexpected error req=${res.json.requestId}$`));
    expect(failed[0]!.line).toContain('Error: disk full');
    expect(failed[0]!.line).not.toContain('secret-in-the-query');
  });

  it('ends: the lines go back to the standard outputs', () => { setLogSink(prev); });
});
