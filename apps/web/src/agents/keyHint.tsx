import type { PublicInstance } from '../api';
import { T } from '../i18n/T';

/** What to do so that Intendia can chat with a new agent: its API server key goes in profileKeys. */
export function keyHint(name: string, source: PublicInstance['source']) {
  return source === 'env'
    ? <T k="Pour discuter avec {name} depuis Intendia, ajoutez sa clé API server dans {keys} de l’instance (variable {env}), puis redémarrez Intendia."
        vars={{ name: <code className="font-mono">{name}</code>, keys: <code className="font-mono">profileKeys</code>, env: <code className="font-mono">INTENDIA_INSTANCES</code> }} />
    : <T k="Pour discuter avec {name} depuis Intendia, ajoutez sa clé API server dans {keys} de l’instance par {route} (voir docs/install.md)."
        vars={{ name: <code className="font-mono">{name}</code>, keys: <code className="font-mono">profileKeys</code>, route: <code className="font-mono">POST /x/instances</code> }} />;
}
