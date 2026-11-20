const HALF_LIFE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface WeightedPricePoint {
  price: number;
  weight: number;
  createdAt: number;
}

export interface PricePoint {
  price: number;
  location?: string;
  placeName?: string;
  createdAt?: number;
}

export interface PriceStats {
  count: number;
  min: number | null;
  max: number | null;
  median: number | null;
  average: number | null;
}

export interface FairPriceBand {
  median: number | null;
  p25: number | null;
  p75: number | null;
  mad: number | null;
  sampleCount: number;
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
  const madRaw =
    absDev.length % 2
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

export function classifyByBand(
  price: number,
  band: FairPriceBand
): { tag: 'عادل' | 'مرتفع' | 'منخفض' | 'شاذ'; deviationPercent: number } {
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

export function normalizePriceValue(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d.]/g, '').trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

export function calculateMedianPrice(values: number[]): number | null {
  const valid = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (valid.length === 0) return null;
  const sorted = valid.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100;
  }
  return sorted[mid];
}

export function calculatePriceStats(values: number[]): PriceStats {
  const valid = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (valid.length === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      median: null,
      average: null,
    };
  }

  let sum = 0;
  let min = valid[0];
  let max = valid[0];

  for (let i = 0; i < valid.length; i++) {
    const val = valid[i];
    sum += val;
    if (val < min) min = val;
    if (val > max) max = val;
  }

  const average = Math.round((sum / valid.length) * 100) / 100;
  const median = calculateMedianPrice(valid);

  return {
    count: valid.length,
    min,
    max,
    median,
    average,
  };
}

export function calculateDiscountPercent(price: number, referencePrice: number | null): number {
  if (
    typeof price !== 'number' ||
    !Number.isFinite(price) ||
    referencePrice === null ||
    !Number.isFinite(referencePrice) ||
    referencePrice <= 0 ||
    price >= referencePrice
  ) {
    return 0;
  }
  return Math.max(0, Math.round(((referencePrice - price) / referencePrice) * 100));
}

export function isSuspiciousLowPrice(
  price: number,
  referencePrice: number | null,
  band?: FairPriceBand
): boolean {
  if (band && isAnomalousLow(price, band)) {
    return true;
  }
  if (
    typeof price !== 'number' ||
    !Number.isFinite(price) ||
    referencePrice === null ||
    !Number.isFinite(referencePrice) ||
    referencePrice <= 0
  ) {
    return false;
  }
  return price < referencePrice * 0.45;
}
