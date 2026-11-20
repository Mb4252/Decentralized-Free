// core/pricing.ts

const HALF_LIFE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface WeightedPricePoint {
  price: number;
  weight: number;
  createdAt: number;
}

function recencyWeight(createdAt: number, now: number): number {
  const ageDays = Math.max(0, (now - createdAt) / DAY_MS);
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

export function weightedMedian(points: WeightedPricePoint[], now: number): number | null {
  if (points.length === 0) return null;
  const arr = points
    .map((p) => ({
      price: p.price,
      w: Math.max(0.0001, p.weight * recencyWeight(p.createdAt, now)),
    }))
    .sort((a, b) => a.price - b.price);
  const total = arr.reduce((s, x) => s + x.w, 0);
  if (total <= 0) return null;
  let acc = 0;
  for (const x of arr) {
    acc += x.w;
    if (acc >= total / 2) return Math.round(x.price * 100) / 100;
  }
  return Math.round(arr[arr.length - 1].price * 100) / 100;
}

export interface FairPriceBand {
  median: number | null;
  p25: number | null;
  p75: number | null;
  mad: number | null;
  sampleCount: number;
}

export function computeFairBand(points: WeightedPricePoint[], now: number): FairPriceBand {
  if (points.length === 0) {
    return { median: null, p25: null, p75: null, mad: null, sampleCount: 0 };
  }
  const sorted = points.map((p) => p.price).sort((a, b) => a - b);
  const quantile = (q: number) => {
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    const next = sorted[base + 1] ?? sorted[base];
    return Math.round((sorted[base] + rest * (next - sorted[base])) * 100) / 100;
  };
  const median = weightedMedian(points, now) ?? quantile(0.5);
  const absDev = sorted.map((p) => Math.abs(p - median)).sort((a, b) => a - b);
  const madRaw = absDev.length % 2
    ? absDev[Math.floor(absDev.length / 2)]
    : (absDev[absDev.length / 2 - 1] + absDev[absDev.length / 2]) / 2;
  return {
    median,
    p25: quantile(0.25),
    p75: quantile(0.75),
    mad: Math.round(madRaw * 100) / 100,
    sampleCount: points.length,
  };
}

export function isAnomalousLow(price: number, band: FairPriceBand): boolean {
  if (band.median == null || band.mad == null || band.mad === 0) return false;
  return price < band.median - 2.5 * 1.4826 * band.mad;
}

export function classifyByBand(price: number, band: FairPriceBand): {
  tag: 'عادل' | 'مرتفع' | 'منخفض' | 'شاذ';
  deviationPercent: number;
} {
  if (band.median == null || band.median <= 0) {
    return { tag: 'عادل', deviationPercent: 0 };
  }
  const diffRatio = (price - band.median) / band.median;
  const deviationPercent = Math.round(diffRatio * 1000) / 10;
  if (Math.abs(diffRatio) >= 0.35) return { tag: 'شاذ', deviationPercent };
  if (diffRatio > 0.12) return { tag: 'مرتفع', deviationPercent };
  if (diffRatio < -0.12) return { tag: 'منخفض', deviationPercent };
  return { tag: 'عادل', deviationPercent };
}
