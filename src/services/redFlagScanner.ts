export type RedFlagResult = { flagged: boolean; reason?: string };

const BLOCK_TERMS = [
  'already rented',
  'sold',
  'no agents',
  'do not contact',
  'section 8',
  'scam',
];

export function scanRedFlags(text: string): RedFlagResult {
  const lower = (text || '').toLowerCase();
  for (const term of BLOCK_TERMS) {
    if (lower.includes(term)) {
      return { flagged: true, reason: term };
    }
  }
  return { flagged: false };
}


