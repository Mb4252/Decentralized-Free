// core/reputation.ts
import type { PlaceFeedbackReport, PlaceFeedbackVerdict } from './types';

const VERDICT_WEIGHT: Record<PlaceFeedbackVerdict, number> = {
  honest_low: 2,
  fair: 1,
  expensive: -1,
  deceptive: -3,
};

const HALF_LIFE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReporterWeightLookup {
  (reporterPeerId: string): number;
}

export interface ReputationResult {
  priceScore: number;
  honestyScore: number;
  deceptiveUnique: number;
  isExcluded: boolean;
  netWeight: number;
  statusLabel:
    | 'معتمد ومخفض'
    | 'معتمد وعادل'
    | 'مرتفع السعر'
    | 'مستبعد (بلاغات خداع)'
    | 'تحت الرصد';
}

export const DEFAULT_REPORTER_WEIGHT: ReporterWeightLookup = () => 1;

export function computeReputation(
  reports: PlaceFeedbackReport[],
  placeKey: string,
  weightOf: ReporterWeightLookup,
  now: number
): ReputationResult {
  let priceScore = 0;
  let honestyScore = 0;
  let netWeight = 0;
  const deceptivePeers = new Set<string>();

  for (const r of reports) {
    if (r.targetPlaceKey !== placeKey) continue;
    const ageDays = Math.max(0, (now - r.createdAt) / DAY_MS);
    const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    const w = Math.max(0.25, weightOf(r.reporterPeerId)) * decay;
    const base = VERDICT_WEIGHT[r.verdict] ?? 0;

    if (r.verdict === 'deceptive') {
      honestyScore += base * w;
      netWeight += Math.abs(base) * w;
      if (r.reporterPeerId) deceptivePeers.add(r.reporterPeerId);
    } else if (r.verdict === 'expensive') {
      priceScore += base * w;
      netWeight += Math.abs(base) * w;
    } else {
      priceScore += base * w;
    }
  }

  const deceptiveUnique = deceptivePeers.size;
  const isExcluded = netWeight >= 6 && deceptiveUnique >= 3 && honestyScore <= -2;

  let statusLabel: ReputationResult['statusLabel'] = 'تحت الرصد';
  if (isExcluded) {
    statusLabel = 'مستبعد (بلاغات خداع)';
  } else if (priceScore >= 3 && honestyScore >= 0) {
    statusLabel = 'معتمد ومخفض';
  } else if (priceScore <= -2 && honestyScore >= -1) {
    statusLabel = 'مرتفع السعر';
  } else if (priceScore > 0 || honestyScore > 0) {
    statusLabel = 'معتمد وعادل';
  }

  return { priceScore, honestyScore, deceptiveUnique, isExcluded, netWeight, statusLabel };
}
