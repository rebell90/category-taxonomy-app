#!/usr/bin/env tsx
// One-time script: create FitTerm makes and models that exist in ProductFitment
// rows but are missing from the FitTerm table.
// Safe to re-run — skips anything that already exists.

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function getOrCreateMake(name: string): Promise<string> {
  const existing = await prisma.fitTerm.findFirst({ where: { type: 'MAKE', name } });
  if (existing) { console.log(`  make exists:   ${name}`); return existing.id; }
  const created = await prisma.fitTerm.create({ data: { type: 'MAKE', name, parentId: null } });
  console.log(`  created make:  ${name}  (${created.id})`);
  return created.id;
}

async function getMakeId(name: string): Promise<string> {
  const t = await prisma.fitTerm.findFirst({ where: { type: 'MAKE', name } });
  if (!t) throw new Error(`Make "${name}" not found`);
  return t.id;
}

async function getOrCreateModel(name: string, makeId: string, makeName: string): Promise<string> {
  const existing = await prisma.fitTerm.findFirst({ where: { type: 'MODEL', name, parentId: makeId } });
  if (existing) { console.log(`  model exists:  ${makeName} / ${name}`); return existing.id; }
  const created = await prisma.fitTerm.create({ data: { type: 'MODEL', name, parentId: makeId } });
  console.log(`  created model: ${makeName} / ${name}  (${created.id})`);
  return created.id;
}

async function main() {
  console.log('Creating missing FitTerms...\n');

  // ── New makes ──────────────────────────────────────────────────────────────
  await getOrCreateMake('Jeep');
  await getOrCreateMake('Ram');

  // ── Honda models ───────────────────────────────────────────────────────────
  const hondaId = await getMakeId('Honda');
  await getOrCreateModel('Civic',        hondaId, 'Honda');
  await getOrCreateModel('Civic Type R', hondaId, 'Honda');
  await getOrCreateModel('Civic FL5',    hondaId, 'Honda');
  await getOrCreateModel('Civic FK8',    hondaId, 'Honda');

  // ── Ford models ────────────────────────────────────────────────────────────
  const fordId = await getMakeId('Ford');
  await getOrCreateModel('Mustang GT/GT500', fordId, 'Ford');
  await getOrCreateModel('Bronco',           fordId, 'Ford');

  // ── Toyota models ──────────────────────────────────────────────────────────
  const toyotaId = await getMakeId('Toyota');
  await getOrCreateModel('GR Supra', toyotaId, 'Toyota');

  // ── BMW models ─────────────────────────────────────────────────────────────
  const bmwId = await getMakeId('BMW');
  await getOrCreateModel('M2',       bmwId, 'BMW');
  await getOrCreateModel('3 series', bmwId, 'BMW');
  await getOrCreateModel('328i',     bmwId, 'BMW');

  // ── Nissan models ──────────────────────────────────────────────────────────
  const nissanId = await getMakeId('Nissan');
  await getOrCreateModel('GT-R', nissanId, 'Nissan');

  // ── Subaru models ──────────────────────────────────────────────────────────
  const subaruId = await getMakeId('Subaru');
  await getOrCreateModel('WRX',     subaruId, 'Subaru');
  await getOrCreateModel('WRX STI', subaruId, 'Subaru');

  // ── Porsche models ─────────────────────────────────────────────────────────
  const porscheId = await getMakeId('Porsche');
  await getOrCreateModel('911', porscheId, 'Porsche');

  // ── Volkswagen models ──────────────────────────────────────────────────────
  const vwId = await getMakeId('Volkswagen');
  await getOrCreateModel('Golf GTI/R', vwId, 'Volkswagen');

  console.log('\n✅ Done.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
