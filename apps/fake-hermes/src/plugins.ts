// Agent plugins of the dashboard (Hermes 0.23 `/api/dashboard/plugins/hub|catalog`, `/api/dashboard/agent-plugins/*`).
// Install is synchronous as at Hermes (delay FAKE_PLUGIN_INSTALL_MS, default 2 s); scenarios by catalog name.

type Json = Record<string, unknown>;
type Reply = { status: number; body: Json };

const SHA = (c: string) => c.repeat(40);
const HOME = '/opt/data/plugins';

/** Catalog of the fake: `notes-rapides` installs, `capacites-elargies` asks for consent, `scan-refuse` is blocked
 * by the scan, `meteo-locale` is installed with an update; `ancien` is withdrawn. */
export const FAKE_PLUGIN_CATALOG = [
  { name: 'notes-rapides', title: 'Notes rapides', description: 'Outil de prise de notes dans un fichier du workspace.', maintainer: 'intendia-fake', tier: 'official', category: 'tools', version: '1.2.0', sha: SHA('a'), tools: ['note_add', 'note_list'], hooks: [], middleware: [], env: [], issues: [] },
  { name: 'capacites-elargies', title: '', description: 'Plugin qui demande des capacités en plus à l’installation.', maintainer: 'quelquun', tier: 'community', category: 'tools', version: '0.3.0', sha: SHA('b'), tools: ['web_fetch_plus'], hooks: ['on_message'], middleware: ['rewrite'], env: ['PLUS_API_KEY'], issues: ['Lent sur les gros messages.'] },
  { name: 'scan-refuse', title: 'Scan refusé', description: 'Son code est refusé par le scan de sécurité d’Hermes.', maintainer: 'inconnu', tier: 'community', category: 'tools', version: '0.0.1', sha: SHA('c'), tools: [], hooks: ['pre_tool'], middleware: [], env: [], issues: [] },
  { name: 'meteo-locale', title: 'Météo locale', description: 'Prévisions par Météo-France.', maintainer: 'meteo', tier: 'verified', category: 'data', version: '2.0.0', sha: SHA('d'), tools: ['weather'], hooks: [], middleware: [], env: ['METEO_TOKEN'], issues: [] },
];

interface Installed { name: string; version: string; description: string; source: string; status: string; canRemove: boolean; sha: string | null; authCommand: string }

export class PluginStore {
  private readonly installed: Installed[] = [
    { name: 'memory-honcho', version: '1.0.0', description: 'Honcho memory provider.', source: 'bundled', status: 'inactive', canRemove: false, sha: null, authCommand: '' },
    { name: 'browser-local', version: '1.0.0', description: `Local browser backend (${HOME}/../hermes-agent/plugins/browser).`, source: 'bundled', status: 'enabled', canRemove: false, sha: null, authCommand: '' },
    { name: 'meteo-locale', version: '1.9.0', description: 'Prévisions par Météo-France.', source: 'git', status: 'enabled', canRemove: true, sha: SHA('e'), authCommand: 'hermes plugins auth meteo-locale --token fake-plugin-token-0987654321' },
  ];
  /** Bodies of the install calls (tests). */
  readonly installs: Json[] = [];

  constructor(private readonly delayMs = Number(process.env.FAKE_PLUGIN_INSTALL_MS ?? 2000)) {}

  private find(name: string) {
    return this.installed.find((p) => p.name === name);
  }

  private hub(): Json {
    return {
      plugins: this.installed.map((p) => ({
        name: p.name, version: p.version, description: p.description, source: p.source, runtime_status: p.status,
        has_dashboard_manifest: false, dashboard_manifest: null, path: `${HOME}/${p.name}`, can_remove: p.canRemove,
        can_update_git: p.source === 'git', auth_required: Boolean(p.authCommand), auth_command: p.authCommand, user_hidden: false, removed_reason: null,
      })),
      orphan_dashboard_plugins: [],
      providers: { memory_provider: '', memory_options: [], context_engine: '', context_options: [] },
    };
  }

  private catalog(): Json {
    return {
      entries: [...FAKE_PLUGIN_CATALOG, { name: 'ancien', title: '', description: 'Retiré.', maintainer: 'x', tier: 'community', category: 'tools', version: '0.1.0', sha: SHA('f'), tools: [], hooks: [], middleware: [], env: [], issues: [] }].map((e) => {
        const inst = this.find(e.name);
        return {
          name: e.name, repo: `https://github.com/fake/${e.name}`, sha: e.sha, description: e.description, maintainer: e.maintainer,
          tier: e.tier, category: e.category, requires_hermes: '>=0.22.0', subdir: '', docs_url: `https://github.com/fake/${e.name}#readme`,
          version: e.version, image: '', screenshots: [], readme: '# long readme', platforms: [], title: e.title, onboarding: false,
          capabilities: { provides_tools: e.tools, provides_hooks: e.hooks, provides_middleware: e.middleware, requires_env: e.env },
          known_issues: e.issues, sha_short: e.sha.slice(0, 7), capability_summary: e.description,
          installed: Boolean(inst), installed_sha: inst?.sha ?? null, update_available: Boolean(inst && inst.sha !== e.sha), runtime_status: inst?.status ?? null,
        };
      }),
      removed: [{ name: 'ancien', repo: '', reason: 'Remplacé par notes-rapides.', date: '2026-10-01' }],
      generated_at: '2026-11-01T00:00:00Z',
    };
  }

  async handle(method: string, path: string, body: unknown): Promise<Reply | null> {
    if (method === 'GET' && path === '/api/dashboard/plugins/hub') return { status: 200, body: this.hub() };
    if (method === 'GET' && path === '/api/dashboard/plugins/catalog') return { status: 200, body: this.catalog() };
    if (!path.startsWith('/api/dashboard/agent-plugins/')) return null;
    const b = (body && typeof body === 'object' ? body : {}) as Json;
    if (method === 'POST' && path === '/api/dashboard/agent-plugins/install') {
      this.installs.push(b);
      await new Promise((r) => setTimeout(r, this.delayMs));
      const name = String(b.catalog_name ?? '');
      const e = FAKE_PLUGIN_CATALOG.find((x) => x.name === name && b.identifier === `https://github.com/fake/${x.name}` && b.ref === x.sha);
      if (!e) return { status: 400, body: { detail: `Could not clone ${String(b.identifier)}` } };
      if (this.find(name) && !b.force) return { status: 400, body: { detail: `Plugin '${name}' already exists at ${HOME}/${name}. Use --force.` } };
      if (name === 'scan-refuse') return { status: 400, body: { detail: `Security scan blocked ${name}: hook pre_tool writes to ${HOME}/../.env` } };
      if (name === 'capacites-elargies') {
        return { status: 200, body: { ok: false, consent_required: true, error: `${name} declares hooks and middleware not covered by the catalog pin`, name, sha: e.sha } };
      }
      this.installed.push({ name, version: e.version, description: e.description, source: 'git', status: 'enabled', canRemove: true, sha: e.sha, authCommand: '' });
      return {
        status: 200,
        body: { ok: true, plugin_name: name, warnings: [`Cloned into ${HOME}/${name}`], python_dependencies: [], missing_env: e.env, enabled: true, gateway_reloaded: false, activation: null, restart_required: true, known_issues: e.issues },
      };
    }
    const m = /^\/api\/dashboard\/agent-plugins\/(.+?)(?:\/(enable|disable))?$/.exec(path);
    if (!m) return null;
    const name = decodeURIComponent(m[1]!);
    if (name.includes('..') || name.includes('\\')) return { status: 400, body: { detail: 'Invalid plugin name.' } };
    const p = this.find(name);
    if (method === 'POST' && m[2]) {
      if (!p) return { status: 400, body: { detail: `Plugin '${name}' is not installed.` } };
      p.status = m[2] === 'enable' ? 'enabled' : 'disabled';
      return { status: 200, body: { ok: true, name, enabled: m[2] === 'enable' } };
    }
    if (method === 'DELETE' && !m[2]) {
      if (!p) return { status: 400, body: { detail: `Plugin '${name}' is not installed.` } };
      if (!p.canRemove) return { status: 400, body: { detail: `Plugin '${name}' is bundled and cannot be removed.` } };
      this.installed.splice(this.installed.indexOf(p), 1);
      return { status: 200, body: { ok: true, name } };
    }
    return null;
  }
}
