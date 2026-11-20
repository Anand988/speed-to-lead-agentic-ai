// apps/api/src/modules/chat/chat-intents.constants.ts
export const CANONICAL_INTENTS = [
  'Plan New Installation',
  'Repair & Maintenance',
  'Explore Procedure & Costs',
] as const;

export type CanonicalIntent = (typeof CANONICAL_INTENTS)[number];

export const QUICK_REPLY_INTENT_MAP: Record<string, CanonicalIntent> = {
  'plan new installation': 'Plan New Installation',
  'repair & maintenance': 'Repair & Maintenance',
  'explore procedure & costs': 'Explore Procedure & Costs',
  'book immediate service': 'Repair & Maintenance',
  'request custom quote': 'Explore Procedure & Costs',
  'schedule consultation': 'Plan New Installation',
};

const CANONICAL_INTENT_SET = new Set<string>(CANONICAL_INTENTS);

export function normalizeIntent(raw: unknown): CanonicalIntent | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (CANONICAL_INTENT_SET.has(trimmed)) {
    return trimmed as CanonicalIntent;
  }

  return QUICK_REPLY_INTENT_MAP[trimmed.toLowerCase()] ?? null;
}