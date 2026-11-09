// Prints an Argon2id hash for INTENDIA_PASSWORD_HASH. Usage: node dist/cli/hash-password.js (reads stdin)
import { hash } from '@node-rs/argon2';

const chunks: Buffer[] = [];
for await (const c of process.stdin) chunks.push(c as Buffer);
const password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
if (password.length < 12) {
  console.error('Password must be at least 12 characters');
  process.exit(1);
}
console.log(await hash(password, { algorithm: 2 }));
