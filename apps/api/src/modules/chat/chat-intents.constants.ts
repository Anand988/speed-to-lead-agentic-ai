import type { VerticalMetadataConfig } from '../tenant/entities/vertical.entity.js';

export const CANONICAL_INTENTS = [
  'Plan New Installation',
  'Repair & Maintenance',
  'Explore Procedure & Costs',
] as const;

export type CanonicalIntent = (typeof CANONICAL_INTENTS)[number];

export const QUICK_REPLY_INTENT_MAP: Record<string, string> = {
  'plan new installation': 'Plan New Installation',
  'repair & maintenance': 'Repair & Maintenance',
  'explore procedure & costs': 'Explore Procedure & Costs',
  'book immediate service': 'Repair & Maintenance',
  'request custom quote': 'Explore Procedure & Costs',
  'schedule consultation': 'Plan New Installation',
};

export function normalizeIntent(
  raw: unknown,
  metadata?: VerticalMetadataConfig | null,
): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  // 1. Check DB-driven vertical canonicalIntents & intentAliases first
  const dbIntents = metadata?.canonicalIntents;
  if (Array.isArray(dbIntents) && dbIntents.length > 0) {
    const exactDbMatch = dbIntents.find((intent) => intent.toLowerCase() === lower);
    if (exactDbMatch) return exactDbMatch;
  }

  const dbAliases = metadata?.intentAliases;
  if (dbAliases && typeof dbAliases === 'object') {
    for (const [alias, canonical] of Object.entries(dbAliases)) {
      if (alias.toLowerCase().trim() === lower) {
        return canonical;
      }
    }
  }

  // 2. Fallback to baseline canonical intents if vertical metadata hasn't overridden them
  const exactDefault = CANONICAL_INTENTS.find((intent) => intent.toLowerCase() === lower);
  if (exactDefault) return exactDefault;

  return QUICK_REPLY_INTENT_MAP[lower] ?? null;
}