import prisma from '@/lib/prisma';
import { ok, toolError, normalizeForDup, type ToolResult } from './types';

type FitType = 'MAKE' | 'MODEL' | 'TRIM' | 'CHASSIS';

async function findNearDup(
  type: FitType,
  name: string,
  parentId: string | null,
  excludeId?: string,
): Promise<string | null> {
  const norm = normalizeForDup(name);
  const siblings = await prisma.fitTerm.findMany({
    where: {
      type,
      parentId: parentId ?? null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, name: true },
  });
  const dup = siblings.find((s) => normalizeForDup(s.name) === norm);
  return dup ? dup.name : null;
}

// ——— create_make ———————————————————————————————————————————————————————

export async function handleCreateMake(args: { name: string }): Promise<ToolResult> {
  const name = args.name.trim();
  const dup = await findNearDup('MAKE', name, null);
  if (dup) return toolError(`A make named "${dup}" already exists (near-duplicate)`);

  const created = await prisma.fitTerm.create({
    data: { type: 'MAKE', name, parentId: null },
    select: { id: true, type: true, name: true },
  });
  return ok(created);
}

// ——— create_model ——————————————————————————————————————————————————————

export async function handleCreateModel(args: {
  name: string;
  makeId: string;
}): Promise<ToolResult> {
  const name = args.name.trim();

  const make = await prisma.fitTerm.findUnique({ where: { id: args.makeId }, select: { id: true, type: true, name: true } });
  if (!make) return toolError(`makeId "${args.makeId}" not found`);
  if (make.type !== 'MAKE') return toolError(`makeId "${args.makeId}" is type ${make.type}, not MAKE`);

  const dup = await findNearDup('MODEL', name, args.makeId);
  if (dup) return toolError(`A model named "${dup}" already exists under make "${make.name}" (near-duplicate)`);

  const created = await prisma.fitTerm.create({
    data: { type: 'MODEL', name, parentId: args.makeId },
    select: { id: true, type: true, name: true, parentId: true },
  });
  return ok(created);
}

// ——— create_chassis ——————————————————————————————————————————————————

export async function handleCreateChassis(args: {
  name: string;
  parentId: string;
}): Promise<ToolResult> {
  const name = args.name.trim();

  const parent = await prisma.fitTerm.findUnique({ where: { id: args.parentId }, select: { id: true, type: true, name: true } });
  if (!parent) return toolError(`parentId "${args.parentId}" not found`);
  if (parent.type !== 'MAKE' && parent.type !== 'MODEL') {
    return toolError(`CHASSIS must have a MAKE or MODEL parent, got ${parent.type}`);
  }

  const dup = await findNearDup('CHASSIS', name, args.parentId);
  if (dup) return toolError(`A chassis named "${dup}" already exists under "${parent.name}" (near-duplicate)`);

  const created = await prisma.fitTerm.create({
    data: { type: 'CHASSIS', name, parentId: args.parentId },
    select: { id: true, type: true, name: true, parentId: true },
  });
  return ok(created);
}

// ——— update_vehicle ———————————————————————————————————————————————————

export async function handleUpdateVehicle(args: {
  id: string;
  name: string;
}): Promise<ToolResult> {
  const name = args.name.trim();

  const term = await prisma.fitTerm.findUnique({ where: { id: args.id }, select: { id: true, type: true, name: true, parentId: true } });
  if (!term) return toolError(`FitTerm "${args.id}" not found`);

  const dup = await findNearDup(term.type as FitType, name, term.parentId, args.id);
  if (dup) return toolError(`A ${term.type} named "${dup}" already exists in the same group (near-duplicate)`);

  const updated = await prisma.fitTerm.update({
    where: { id: args.id },
    data: { name },
    select: { id: true, type: true, name: true, parentId: true },
  });
  return ok(updated);
}
