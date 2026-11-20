import type { MarketEntry, RankedMatch } from './types';
import { geoProximity, normalizeGeoText } from './normalization';

function itemKey(s: string): string {
  return normalizeGeoText(s);
}

function valueBalance(a: MarketEntry, b: MarketEntry): number {
  const pa = typeof a.price === 'number' ? a.price : null;
  const pb = typeof b.price === 'number' ? b.price : null;
  if (pa == null || pb == null || pa <= 0 || pb <= 0) return 0.5;
  return Math.min(pa, pb) / Math.max(pa, pb);
}

function recencyScore(createdAt: number, now: number): number {
  const days = Math.max(0, (now - createdAt) / (24 * 60 * 60 * 1000));
  return Math.max(0, 1 - days / 30);
}

export function scoreDirectMatch(
  offer: MarketEntry,
  demand: MarketEntry,
  now: number
): number {
  if (offer.authorPeerId && offer.authorPeerId === demand.authorPeerId) return 0;
  if (offer.kind !== 'have' || demand.kind !== 'need') return 0;

  const overlap =
    itemKey(offer.item) === itemKey(demand.item) ||
    (offer.wantItem && itemKey(offer.wantItem) === itemKey(demand.item))
      ? 1
      : 0;
  if (overlap === 0) return 0;

  const reverseOk =
    demand.wantItem && itemKey(demand.wantItem) === itemKey(offer.item) ? 1 : 0.3;

  const vb = valueBalance(offer, demand);
  const geo = geoProximity(offer.location, demand.location);
  const rec = (recencyScore(offer.createdAt, now) + recencyScore(demand.createdAt, now)) / 2;

  return Math.round(
    (0.45 * overlap + 0.2 * reverseOk + 0.25 * vb + 0.2 * geo + 0.1 * rec) * 100
  );
}

export function findRankedMatches(entries: MarketEntry[], now: number): RankedMatch[] {
  const haves = entries.filter((e) => e.kind === 'have');
  const needs = entries.filter((e) => e.kind === 'need');
  const out: RankedMatch[] = [];

  for (const need of needs) {
    for (const have of haves) {
      const s = scoreDirectMatch(have, need, now);
      if (s < 30) continue;
      const reverse = Boolean(
        have.wantItem &&
          need.wantItem &&
          itemKey(have.wantItem) === itemKey(need.item) &&
          itemKey(need.wantItem) === itemKey(have.item)
      );
      out.push({
        id: `${have.id}::${need.id}`,
        type: reverse ? 'reverse' : 'direct',
        score: s,
        giveEntry: have,
        wantEntry: need,
        reason: reverse ? 'تبادل متكافئ' : 'مطابقة مباشرة',
      });
    }
  }

  for (const a of haves) {
    for (const b of haves) {
      if (a.id === b.id) continue;
      for (const c of haves) {
        if (c.id === a.id || c.id === b.id) continue;
        const aToB = needs.some(
          (n) => n.authorPeerId === b.authorPeerId && itemKey(n.item) === itemKey(a.item)
        );
        const bToC = needs.some(
          (n) => n.authorPeerId === c.authorPeerId && itemKey(n.item) === itemKey(b.item)
        );
        const cToA = needs.some(
          (n) => n.authorPeerId === a.authorPeerId && itemKey(n.item) === itemKey(c.item)
        );
        if (aToB && bToC && cToA) {
          out.push({
            id: `cycle-${a.id}-${b.id}-${c.id}`,
            type: 'cycle',
            score: 80,
            giveEntry: a,
            wantEntry: b,
            cyclePath: [a, b, c],
            reason: 'دورة ثلاثية مقترحة',
          });
        }
      }
    }
  }

  return out.sort((x, y) => y.score - x.score);
}
