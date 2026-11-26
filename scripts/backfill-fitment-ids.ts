#!/usr/bin/env tsx
// Backfill FitTerm IDs onto ProductFitment rows that store human-readable names.
// Exact name match only — no fuzzy matching, no guessing.
// Rows with no FitTerm match are reported but never modified.
//
// Usage:
//   npx tsx scripts/backfill-fitment-ids.ts --dry-run   (safe, no writes)
//   npx tsx scripts/backfill-fitment-ids.ts              (live, writes IDs)
//
// Prerequisites: DATABASE_URL must be set.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

function looksLikeId(value: string): boolean {
  // cuid/cuid2 are ~24-25 chars starting with 'c', all lowercase alphanum
  return /^c[a-z0-9]{20,}$/.test(value);
}

async function main() {
  console.log(DRY_RUN ? '🔍 DRY RUN — no changes will be written.\n' : '✍️  LIVE RUN — changes will be written.\n');

  // Load all FitTerms
  const allTerms = await prisma.fitTerm.findMany({
    select: { id: true, type: true, name: true, parentId: true },
  });

  // Build lookup: normalized name → makeId
  const makeByName = new Map<string, string>();
  // makeId → (normalized model name → modelId)
  const modelByMakeAndName = new Map<string, Map<string, string>>();

  for (const t of allTerms) {
    const norm = t.name.trim().toLowerCase();
    if (t.type === 'MAKE') {
      makeByName.set(norm, t.id);
    } else if (t.type === 'MODEL' && t.parentId) {
      if (!modelByMakeAndName.has(t.parentId)) {
        modelByMakeAndName.set(t.parentId, new Map());
      }
      modelByMakeAndName.get(t.parentId)!.set(norm, t.id);
    }
  }

  // Load all fitment rows
  const rows = await prisma.productFitment.findMany({
    select: { id: true, make: true, model: true },
  });

  type Update = { rowId: string; makeId: string; modelId: string };
  type Unresolved = { make: string; model: string; reason: string; count: number };

  const toUpdate: Update[] = [];
  const unmatchedMap = new Map<string, Unresolved>();
  let alreadyIds = 0;

  for (const row of rows) {
    if (looksLikeId(row.make) && looksLikeId(row.model)) {
      alreadyIds++;
      continue;
    }

    const makeNorm  = row.make.trim().toLowerCase();
    const modelNorm = row.model.trim().toLowerCase();
    const key = `${row.make}|||${row.model}`;

    const makeId = makeByName.get(makeNorm);
    if (!makeId) {
      const existing = unmatchedMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        unmatchedMap.set(key, { make: row.make, model: row.model, reason: `make "${row.make}" not in FitTerm`, count: 1 });
      }
      continue;
    }

    const modelId = modelByMakeAndName.get(makeId)?.get(modelNorm);
    if (!modelId) {
      const existing = unmatchedMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        unmatchedMap.set(key, { make: row.make, model: row.model, reason: `model "${row.model}" not found under make "${row.make}"`, count: 1 });
      }
      continue;
    }

    toUpdate.push({ rowId: row.id, makeId, modelId });
  }

  const unresolved = [...unmatchedMap.values()].sort((a, b) => b.count - a.count);

  console.log(`Total rows:      ${rows.length}`);
  console.log(`Already have IDs: ${alreadyIds}`);
  console.log(`Will update:      ${toUpdate.length}`);
  console.log(`Unresolved:       ${unresolved.length} unique make/model combos\n`);

  if (!DRY_RUN && toUpdate.length > 0) {
    console.log('Writing updates...');
    const CHUNK = 50;
    for (let i = 0; i < toUpdate.length; i += CHUNK) {
      const chunk = toUpdate.slice(i, i + CHUNK);
      await Promise.all(
        chunk.map(u =>
          prisma.productFitment.update({
            where: { id: u.rowId },
            data: { make: u.makeId, model: u.modelId },
          })
        )
      );
      process.stdout.write(`  ${Math.min(i + CHUNK, toUpdate.length)}/${toUpdate.length} updated\r`);
    }
    console.log('\n✅ Backfill complete.');
  }

  if (unresolved.length > 0) {
    console.log('\n⚠️  Unresolved rows — manual FitTerm creation needed:');
    console.log('  (These rows continue to work via name-based fallback matching)');
    console.log('');
    for (const u of unresolved) {
      console.log(`  [${u.count} rows] ${u.reason}`);
    }
    console.log('');
    console.log('  To fix: use create_make / create_model MCP tools or the dashboard');
    console.log('  to add the missing FitTerm, then re-run this script.');
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
