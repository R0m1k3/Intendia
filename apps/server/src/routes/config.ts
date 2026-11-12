import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { ConfigInputError, type ConfigService } from '../hermes-config/service.js';
import type { ProvidersService } from '../hermes-config/providers.js';
import { ValidationError } from '../workspaces/service.js';
import { profileOf } from './skills.js';
import { GATEWAY_ACTIONS, type GatewayAction } from '../hermes-config/gateway.js';

const VERSION = z.string().regex(/^[0-9a-f]{16}$/, 'version invalide');
const PATH = z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/);
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

const FormBody = z.object({ changes: z.record(PATH, z.unknown()), version: VERSION });
const RawBody = z.object({ yaml: z.string().max(2_000_000), version: VERSION });
const RestoreBody = z.object({ version: VERSION });
const ModelBody = z.object({
  scope: z.enum(['main', 'auxiliary']),
  provider: z.string().min(1).max(200),
  model: z.string().min(1).max(200),
  task: z.string().min(1).max(64).optional(),
  confirm: z.boolean().optional(),
  version: VERSION,
});
const AuxBody = z.object({
  version: VERSION,
  changes: z.array(z.object({
    task: z.string().regex(/^[a-z_]{1,40}$/),
    provider: z.string().min(1).max(100),
    model: z.string().min(1).max(200),
  })).min(1).max(20),
  confirm: z.boolean().optional(),
});
const EnvBody = z.object({ key: z.string(), value: z.string() });
const McpBody = z.object({
  name: z.string(),
  url: z.string().max(2000).optional(),
  token: z.string().max(4096).optional(),
  command: z.string().max(2000).optional(),
  args: z.array(z.string().max(2000)).max(100).optional(),
  env: z.record(z.string(), z.string().max(16_384)).optional(),
});
const EnabledBody = z.object({ enabled: z.boolean() });

function checkKey(key: string): string {
  if (!KEY_RE.test(key)) throw new ConfigInputError('invalid_key', 'Nom de variable invalide', { key });
  return key;
}

function checkName(name: string): string {
  if (!NAME_RE.test(name)) throw new ConfigInputError('invalid_name', 'Nom de serveur MCP invalide (lettres, chiffres, - et _)');
  return name;
}

/** Same rule as a session's model (PatchSession.model in routes/workspaces.ts). */
const ModelName = z.string().trim().min(1).max(200).regex(/^[^\s]+$/, 'nom de modèle sans espace ni saut de ligne');
/** Built-in provider keys only (`custom:<name>` providers keep their own list, edited in the YAML tab). */
const ProviderModelsBody = z.object({
  provider: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, 'fournisseur non modifiable ici'),
  add: ModelName.optional(),
  remove: ModelName.optional(),
});

const PROVIDER_RE = /^[A-Za-z0-9:._-]{1,100}$/;
const SESSION_RE = /^[A-Za-z0-9_-]{1,128}$/;
const KEY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// the key is never logged nor sent back (the validation errors carry no input)
const ProviderKeyBody = z.object({
  provider: z.string().regex(PROVIDER_RE),
  apiKey: z.string().trim().min(1).max(4000),
  label: z.string().max(80).optional(),
});

// a `claude setup-token` token: same rule, never logged nor sent back; format checked after trim by the service
const AnthropicTokenBody = z.object({
  token: z.string().max(8192),
  replaceApiKey: z.boolean().optional(),
});

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
// same rule for the key as ProviderKeyBody: never logged nor sent back
const CustomProviderBody = z.object({
  name: z.string().max(64),
  baseUrl: z.string().max(2048),
  apiKey: z.string().max(4000).optional(),
  model: z.string().max(200).optional(),
});

const StopBody = z.object({ interrupt: z.boolean().optional() });

function gatewayAction(raw: string | undefined): GatewayAction {
  if (!GATEWAY_ACTIONS.includes(raw as GatewayAction)) throw new ValidationError('action de passerelle inconnue');
  return raw as GatewayAction;
}

export function configRoutes(config: ConfigService, providers: ProvidersService): Hono {
  const r = new Hono();
  const inst = (c: Context) => c.req.param('inst') ?? '';
  const id = (c: Context) => {
    const n = Number(c.req.param('id'));
    if (!Number.isInteger(n) || n <= 0) throw new ConfigInputError('invalid_id', 'Copie invalide');
    return n;
  };

  r.get('/i/:inst/config', async (c) => c.json(await config.form(inst(c), profileOf(c))));
  r.put('/i/:inst/config', async (c) => {
    const body = FormBody.parse(await c.req.json());
    return c.json(await config.saveForm(inst(c), profileOf(c), body.changes, body.version));
  });
  r.get('/i/:inst/config/raw', async (c) => c.json(await config.raw(inst(c), profileOf(c))));
  r.put('/i/:inst/config/raw', async (c) => {
    const body = RawBody.parse(await c.req.json());
    return c.json(await config.saveRaw(inst(c), profileOf(c), body.yaml, body.version));
  });

  r.get('/i/:inst/config/versions', (c) => c.json({ versions: config.versions(inst(c), profileOf(c)) }));
  r.get('/i/:inst/config/versions/:id', (c) => c.json(config.version(inst(c), profileOf(c), id(c))));
  r.post('/i/:inst/config/versions/:id/restore', async (c) => {
    const body = RestoreBody.parse(await c.req.json());
    return c.json(await config.restore(inst(c), profileOf(c), id(c), body.version));
  });

  // ---- provider accounts and API keys (auth.json of the profile)
  const param = (c: Context, name: string, re: RegExp) => {
    const v = c.req.param(name) ?? '';
    if (!re.test(v)) throw new ValidationError(`${name} invalide`);
    return v;
  };
  r.get('/i/:inst/config/providers', async (c) => c.json(await providers.list(inst(c), profileOf(c))));
  r.post('/i/:inst/config/providers/:provider/connect', async (c) =>
    c.json(await providers.start(inst(c), profileOf(c), param(c, 'provider', PROVIDER_RE))));
  r.get('/i/:inst/config/providers/:provider/connect/:session', async (c) =>
    c.json(await providers.poll(inst(c), profileOf(c), param(c, 'provider', PROVIDER_RE), param(c, 'session', SESSION_RE))));
  r.delete('/i/:inst/config/connect/:session', async (c) =>
    c.json(await providers.cancel(inst(c), profileOf(c), param(c, 'session', SESSION_RE))));
  r.delete('/i/:inst/config/providers/:provider/account', async (c) =>
    c.json(await providers.disconnect(inst(c), profileOf(c), param(c, 'provider', PROVIDER_RE))));
  r.post('/i/:inst/config/provider-keys', async (c) => {
    const body = ProviderKeyBody.parse(await c.req.json());
    return c.json(await providers.addKey(inst(c), profileOf(c), body));
  });
  r.delete('/i/:inst/config/provider-keys/:provider/:id', async (c) =>
    c.json(await providers.removeKey(inst(c), profileOf(c), { provider: param(c, 'provider', PROVIDER_RE), id: param(c, 'id', KEY_ID_RE) })));

  r.post('/i/:inst/config/providers/anthropic/token', async (c) => {
    const body = AnthropicTokenBody.parse(await c.req.json());
    return c.json(await config.setAnthropicToken(inst(c), profileOf(c), body.token, body.replaceApiKey === true));
  });
  r.delete('/i/:inst/config/providers/anthropic/token', async (c) => c.json(await config.removeAnthropicToken(inst(c), profileOf(c))));
  r.get('/i/:inst/config/custom-providers', async (c) => c.json(await config.customProviders(inst(c), profileOf(c))));
  r.post('/i/:inst/config/custom-providers', async (c) => {
    const body = CustomProviderBody.parse(await c.req.json());
    // built-in providers of Hermes (catalogue), read outside the config lock
    const known = await providers.list(inst(c), profileOf(c));
    return c.json(await config.addCustomProvider(inst(c), profileOf(c), body, new Set(known.keyProviders.map((p) => p.slug))), 201);
  });
  r.delete('/i/:inst/config/custom-providers/:slug', async (c) =>
    c.json(await config.removeCustomProvider(inst(c), profileOf(c), param(c, 'slug', SLUG_RE))));

  r.get('/i/:inst/config/model-info', async (c) => c.json(await config.modelInfo(inst(c), profileOf(c))));
  r.get('/i/:inst/config/recommended-model', async (c) => {
    const provider = c.req.query('provider') ?? '';
    if (!PROVIDER_RE.test(provider)) throw new ValidationError('provider invalide');
    return c.json(await config.recommendedModel(inst(c), profileOf(c), provider));
  });
  r.get('/i/:inst/config/models', async (c) => c.json(await config.models(inst(c), profileOf(c))));
  r.post('/i/:inst/config/models', async (c) => {
    const body = ModelBody.parse(await c.req.json());
    if ((body.scope === 'auxiliary') !== (body.task !== undefined)) {
      throw new ConfigInputError('invalid_task', 'Une tâche est obligatoire pour un modèle auxiliaire, et seulement pour lui');
    }
    return c.json(await config.setModel(inst(c), profileOf(c), body));
  });

  // several auxiliary models in one write, all or nothing
  r.post('/i/:inst/config/auxiliary', async (c) => {
    const body = AuxBody.parse(await c.req.json());
    return c.json(await config.setAuxiliary(inst(c), profileOf(c), body));
  });

  r.post('/i/:inst/config/provider-models', async (c) => {
    const body = ProviderModelsBody.parse(await c.req.json());
    if ((body.add === undefined) === (body.remove === undefined)) {
      throw new ConfigInputError('invalid_change', 'Donner un modèle à ajouter ou à retirer (un seul)');
    }
    const change = body.add !== undefined ? { add: body.add } : { remove: body.remove! };
    return c.json(await config.changeProviderModels(inst(c), profileOf(c), body.provider, change));
  });

  r.get('/i/:inst/config/env', async (c) => c.json({ env: await config.env(inst(c), profileOf(c)) }));
  r.put('/i/:inst/config/env', async (c) => {
    const body = EnvBody.parse(await c.req.json());
    checkKey(body.key);
    if (!body.value || body.value.includes('«') || body.value.length > 16_384) {
      throw new ConfigInputError('invalid_value', 'Valeur vide, masquée ou trop longue');
    }
    return c.json(await config.setEnv(inst(c), profileOf(c), body.key, body.value));
  });
  r.delete('/i/:inst/config/env/:key', async (c) => c.json(await config.deleteEnv(inst(c), profileOf(c), checkKey(c.req.param('key')))));

  r.get('/i/:inst/config/mcp', async (c) => c.json({ servers: await config.mcp(inst(c), profileOf(c)) }));
  r.post('/i/:inst/config/mcp', async (c) => {
    const body = McpBody.parse(await c.req.json());
    checkName(body.name);
    const byUrl = body.url !== undefined && body.url !== '';
    const byCommand = body.command !== undefined && body.command !== '';
    const valid = byUrl !== byCommand
      && (!byUrl || (/^https?:\/\/\S+$/i.test(body.url!) && body.args === undefined && body.env === undefined))
      && (!byCommand || body.token === undefined)
      && Object.keys(body.env ?? {}).every((k) => KEY_RE.test(k));
    if (!valid) throw new ConfigInputError('invalid_mcp', 'Donner une URL (avec jeton facultatif) ou une commande (avec arguments et variables)');
    return c.json(await config.addMcp(inst(c), profileOf(c), body), 201);
  });
  r.post('/i/:inst/config/mcp/:name/test', async (c) => c.json(await config.testMcp(inst(c), profileOf(c), checkName(c.req.param('name')))));
  r.put('/i/:inst/config/mcp/:name/enabled', async (c) => {
    const body = EnabledBody.parse(await c.req.json());
    return c.json(await config.enableMcp(inst(c), profileOf(c), checkName(c.req.param('name')), body.enabled));
  });
  r.delete('/i/:inst/config/mcp/:name', async (c) => c.json(await config.removeMcp(inst(c), profileOf(c), checkName(c.req.param('name')))));

  r.get('/i/:inst/config/platforms', async (c) => c.json({ platforms: await config.platforms(inst(c), profileOf(c)) }));
  // start | stop | restart; stop takes {interrupt?: boolean} (ends the live sessions)
  r.post('/i/:inst/config/gateway/:action', async (c) => {
    const action = gatewayAction(c.req.param('action'));
    const body = action === 'stop' ? StopBody.parse(await c.req.json().catch(() => ({}))) : {};
    return c.json(await config.gateway.run(inst(c), profileOf(c), action, body.interrupt ?? false), 202);
  });
  r.get('/i/:inst/config/gateway/:action', async (c) => c.json(await config.gateway.status(inst(c), profileOf(c), gatewayAction(c.req.param('action')))));
  return r;
}
