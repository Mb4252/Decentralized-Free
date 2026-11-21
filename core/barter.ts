import type { MarketEntry, RankedMatch } from './types';
import { geoProximity, normalizeGeoText } from './normalization';

export type { RankedMatch };

export interface SmartMatch {
  id: string;
  type: 'direct' | 'reverse' | 'cycle';
  giveEntry: MarketEntry;
  wantEntry: MarketEntry;
  thirdEntry?: MarketEntry;
  score: number;
  reason: string;
}

function itemKey(s: string): string {
  return normalizeGeoText(s).replace(/\s+/g, '');
}

function isSameItem(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ka = itemKey(a);
  const kb = itemKey(b);
  if (!ka || !kb) return false;
  return ka === kb || ka.includes(kb) || kb.includes(ka);
}

export function scoreDirectMatch(offer: MarketEntry, request: MarketEntry): number {
  if (!isSameItem(offer.item, request.item)) return 0;

  let score = 60;

  if (offer.wantItem && request.wantItem && isSameItem(offer.wantItem, request.wantItem)) {
    score += 20;
  } else if (offer.wantItem && isSameItem(offer.wantItem, request.item)) {
    score += 10;
  }

  const prox = geoProximity(offer.location, request.location);
  score += Math.round(prox * 20);

  return Math.min(100, Math.max(0, score));
}

function computeSmartMatches(entries: MarketEntry[], _now?: number): SmartMatch[] {
  void _now;
  const offers = entries.filter((e) => e.kind === 'have');
  const requests = entries.filter((e) => e.kind === 'need');
  const results: SmartMatch[] = [];

  for (const offer of offers) {
    for (const req of requests) {
      if (offer.id === req.id) continue;
      const directScore = scoreDirectMatch(offer, req);
      if (directScore >= 60) {
        results.push({
          id: `${offer.id}-${req.id}`,
          type: 'direct',
          giveEntry: offer,
          wantEntry: req,
          score: directScore,
          reason: `مطابقة مباشرة لسلعة «${req.item}»`,
        });
      }
    }
  }

  for (let i = 0; i < offers.length; i++) {
    for (let j = 0; j < offers.length; j++) {
      if (i === j) continue;
      const a = offers[i];
      const b = offers[j];
      if (!a.wantItem || !b.wantItem) continue;

      const reqForA = requests.find((r) => isSameItem(r.item, a.wantItem));
      const reqForB = requests.find((r) => isSameItem(r.item, b.wantItem));
      if (reqForA && reqForB && reqForA.id !== reqForB.id) {
        const prox = geoProximity(a.location, b.location);
        const cycleScore = Math.min(92, 65 + Math.round(prox * 20));
        results.push({
          id: `cycle3-${a.id}-${b.id}-${reqForA.id}`,
          type: 'cycle',
          giveEntry: a,
          wantEntry: reqForA,
          thirdEntry: b,
          score: cycleScore,
          reason: `مقايضة ثلاثية مقترحة عبر «${a.item}» و«${b.item}»`,
        });
      }
    }
  }

  return results.sort((x, y) => y.score - x.score);
}

export function findRankedMatches(entries: MarketEntry[], now?: number): RankedMatch[] {
  return computeSmartMatches(entries, now).map(({ thirdEntry: _ignored, reason, ...ranked }) => ({
    ...ranked,
    reason: reason || 'مطابقة مقترحة',
  }));
}

export function findBarterMatches(entries: MarketEntry[], now?: number): SmartMatch[] {
  return computeSmartMatches(entries, now);
}
