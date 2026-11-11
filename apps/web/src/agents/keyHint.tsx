import type { PublicInstance } from '../api';

/** What to do so that Intendia can chat with a new agent: its API server key goes in profileKeys. */
export function keyHint(name: string, source: PublicInstance['source']) {
  return source === 'env'
    ? <>Pour discuter avec <code className="font-mono">{name}</code> depuis Intendia, ajoutez sa clé API server dans <code className="font-mono">profileKeys</code> de l’instance (variable <code className="font-mono">INTENDIA_INSTANCES</code>), puis redémarrez Intendia.</>
    : <>Pour discuter avec <code className="font-mono">{name}</code> depuis Intendia, ajoutez sa clé API server dans <code className="font-mono">profileKeys</code> de l’instance par <code className="font-mono">POST /x/instances</code> (voir docs/install.md).</>;
}
