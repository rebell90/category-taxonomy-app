#!/usr/bin/env tsx
// Generate an MCP API key, store its SHA-256 hash in the database, and print
// the plaintext ONCE.  The plaintext is never stored.
//
// Usage:
//   npx tsx scripts/generate-api-key.ts --name grok-bot --scopes read
//   npx tsx scripts/generate-api-key.ts --name grok-bot-rw --scopes read,write
//
// Prerequisites: DATABASE_URL must be set in the environment (or .env file).

import { randomBytes, createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function usage() {
  console.error(
    'Usage: npx tsx scripts/generate-api-key.ts --name <name> [--scopes read|read,write]',
  );
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);

  const nameIdx = args.indexOf('--name');
  if (nameIdx === -1 || nameIdx + 1 >= args.length) usage();
  const name = args[nameIdx + 1];

  const scopesIdx = args.indexOf('--scopes');
  const scopesStr =
    scopesIdx !== -1 && scopesIdx + 1 < args.length ? args[scopesIdx + 1] : 'read';

  const scopes = scopesStr
    .split(',')
    .map((s) => s.trim())
    .filter((s) => ['read', 'write'].includes(s));

  if (scopes.length === 0) {
    console.error('Invalid --scopes value. Use "read" or "read,write".');
    process.exit(1);
  }

  const plaintext = randomBytes(32).toString('base64url');
  const keyHash = createHash('sha256').update(plaintext).digest('hex');

  await prisma.apiKey.create({ data: { name, keyHash, scopes } });

  console.log('\n✅ API key created and hash stored.');
  console.log(`   Name   : ${name}`);
  console.log(`   Scopes : ${scopes.join(', ')}`);
  console.log('\n   Key (copy now — this will NOT be shown again):\n');
  console.log(`   ${plaintext}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
