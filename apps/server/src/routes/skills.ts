import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { SkillService } from '../skills/service.js';
import { ValidationError } from '../workspaces/service.js';
import { PROFILE_RE } from './params.js';

const NAME = z.string().regex(/^[A-Za-z0-9_.:/-]{1,160}$/, 'nom de skill invalide');
const IDENTIFIER = z.string().max(300).refine(
  (v) => /^[A-Za-z0-9_.:/@-]{1,300}$/.test(v) || /^https:\/\/[^\s]+$/.test(v),
  'identifiant de hub invalide',
);
const ACTION_RE = /^skills-[a-z0-9-]{1,120}$/;

const EnabledBody = z.object({ name: NAME, enabled: z.boolean() });
const InstallBody = z.object({ identifier: IDENTIFIER, acknowledged: z.boolean().default(false) });
const UninstallBody = z.object({ name: NAME });

/** `?profile=`, `default` when absent. */
export function profileOf(c: Context): string {
  const profile = c.req.query('profile') ?? 'default';
  if (!PROFILE_RE.test(profile)) throw new ValidationError('profil invalide');
  return profile;
}

export function skillRoutes(skills: SkillService): Hono {
  const r = new Hono();
  const inst = (c: Context) => c.req.param('inst') ?? '';

  r.get('/i/:inst/skills', async (c) => c.json({ skills: await skills.list(inst(c), profileOf(c)) }));
  r.put('/i/:inst/skills/enabled', async (c) => {
    const body = EnabledBody.parse(await c.req.json());
    return c.json({ skill: await skills.setEnabled(inst(c), profileOf(c), body.name, body.enabled) });
  });
  r.get('/i/:inst/skills/content', async (c) => {
    const name = NAME.parse(c.req.query('name') ?? '');
    return c.json(await skills.content(inst(c), profileOf(c), name));
  });
  r.get('/i/:inst/skills/toolsets', async (c) => c.json({ toolsets: await skills.toolsets(inst(c), profileOf(c)) }));

  r.get('/i/:inst/skills/hub/official', async (c) => c.json(await skills.official(inst(c), profileOf(c))));
  r.get('/i/:inst/skills/hub/search', async (c) => {
    const q = z.string().trim().min(1).max(200).parse(c.req.query('q') ?? '');
    return c.json(await skills.search(inst(c), profileOf(c), q));
  });
  r.get('/i/:inst/skills/hub/scan', async (c) => {
    const identifier = IDENTIFIER.parse(c.req.query('identifier') ?? '');
    return c.json({ scan: await skills.scan(inst(c), profileOf(c), identifier) });
  });
  r.post('/i/:inst/skills/hub/install', async (c) => {
    const body = InstallBody.parse(await c.req.json());
    return c.json(await skills.install(inst(c), profileOf(c), body.identifier, body.acknowledged), 202);
  });
  r.post('/i/:inst/skills/hub/uninstall', async (c) => {
    const body = UninstallBody.parse(await c.req.json());
    return c.json(await skills.uninstall(inst(c), profileOf(c), body.name), 202);
  });
  r.post('/i/:inst/skills/hub/update', async (c) => c.json(await skills.update(inst(c), profileOf(c)), 202));
  r.get('/i/:inst/skills/hub/actions/:action', async (c) => {
    const action = c.req.param('action');
    if (!ACTION_RE.test(action)) throw new ValidationError("nom d'action invalide");
    return c.json(await skills.actionStatus(inst(c), action));
  });
  return r;
}
