import { extname } from 'node:path';

const TEXT = 'text/plain; charset=utf-8';

/** Fixed extension → Content-Type table; the server never sniffs content. */
const TYPES: Record<string, string> = {
  '.txt': TEXT, '.log': TEXT, '.csv': 'text/csv; charset=utf-8', '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.markdown': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.jsonl': TEXT, '.yaml': TEXT, '.yml': TEXT, '.toml': TEXT, '.ini': TEXT,
  '.xml': 'application/xml; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': TEXT, '.mjs': TEXT, '.cjs': TEXT, '.ts': TEXT, '.tsx': TEXT, '.jsx': TEXT, '.py': TEXT, '.sh': TEXT,
  '.rs': TEXT, '.go': TEXT, '.java': TEXT, '.c': TEXT, '.h': TEXT, '.cpp': TEXT, '.rb': TEXT, '.php': TEXT, '.sql': TEXT,
  '.env': TEXT,
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.zip': 'application/zip', '.gz': 'application/gzip', '.tar': 'application/x-tar',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function mimeOf(name: string): string {
  const ext = extname(name).toLowerCase();
  if (!ext && /^(readme|license|makefile|dockerfile)$/i.test(name)) return TEXT;
  return TYPES[ext] ?? 'application/octet-stream';
}
