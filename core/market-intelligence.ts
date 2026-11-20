// core/market-intelligence.ts
import type { MarketEntry, PlaceFeedbackReport, PlaceFeedbackVerdict } from './types';
import { matchesZoneFilter, normalizeGeoText } from './geo-focus';
import { computeFairBand, classifyByBand, isAnomalousLow, type WeightedPricePoint } from './pricing';
import {
  computeReputation,
  DEFAULT_REPORTER_WEIGHT,
  type ReporterWeightLookup,
} from './reputation';

export type { PlaceFeedbackVerdict } from './types';

export interface LowestPriceDeal {
  id: string;
  item: string;
  category: string;
  location: string;
  placeName?: string;
  price: number;
  medianPrice: number | null;
  p25: number | null;
  p75: number | null;
  discountPercent: number;
  reportsCountForItem: number;
  isSuspiciousLow: boolean;
  placeTrustScore: number;
  isExcludedByCommunity: boolean;
  entry: MarketEntry;
}

export interface DiscoveredPlaceSummary {
  placeKey: string;
  placeName: string;
  location: string;
  entriesCount: number;
  avgPrice: number | null;
  lowestPrice: number | null;
  honestLowCount: number;
  fairCount: number;
  expensiveCount: number;
  deceptiveCount: number;
  uniqueDeceptiveReporters: number;
  trustScore: number;
  isExcluded: boolean;
  statusLabel:
    | 'معتمد ومخفض'
    | 'معتمد وعادل'
    | 'مرتفع السعر'
    | 'مستبعد (بلاغات خداع)'
    | 'تحت الرصد';
  sampleItems: string[];
}

export const DECEPTIVE_EXCLUSION_THRESHOLD = 3;

export function buildPlaceKey(placeName: string, location: string): string {
  const cleanPlace = normalizeGeoText(placeName || '');
  const cleanLoc = normalizeGeoText(location || '');
  return `${cleanPlace}__${cleanLoc}`.trim();
}

export function evaluatePlaceTrust(
  placeName: string,
  location: string,
  feedbacks: PlaceFeedbackReport[],
  weightOf: ReporterWeightLookup = DEFAULT_REPORTER_WEIGHT,
  now: number = Date.now()
): {
  placeKey: string;
  honestLowCount: number;
  fairCount: number;
  expensiveCount: number;
  deceptiveCount: number;
  uniqueDeceptiveReporters: number;
  trustScore: number;
  isExcluded: boolean;
  statusLabel: DiscoveredPlaceSummary['statusLabel'];
} {
  const placeKey = buildPlaceKey(placeName, location);
  const matching: PlaceFeedbackReport[] = [];

  for (let i = 0; i < feedbacks.length; i++) {
    const f = feedbacks[i];
    if (f.targetPlaceKey === placeKey) {
      matching.push(f);
      continue;
    }
    const samePlace =
      placeName && normalizeGeoText(f.targetPlaceName) === normalizeGeoText(placeName);
    const sameLoc =
      !location || !f.targetLocation || matchesZoneFilter({ location: f.targetLocation }, location);
    if (samePlace && sameLoc) matching.push(f);
  }

  let honestLowCount = 0;
  let fairCount = 0;
  let expensiveCount = 0;
  let deceptiveCount = 0;

  for (const r of matching) {
    if (r.verdict === 'honest_low') honestLowCount += 1;
    else if (r.verdict === 'fair') fairCount += 1;
    else if (r.verdict === 'expensive') expensiveCount += 1;
    else if (r.verdict === 'deceptive') deceptiveCount += 1;
  }

  const rep = computeReputation(matching, placeKey, weightOf, now);

  return {
    placeKey,
    honestLowCount,
    fairCount,
    expensiveCount,
    deceptiveCount,
    uniqueDeceptiveReporters: rep.deceptiveUnique,
    trustScore: Math.round((rep.priceScore + rep.honestyScore) * 10) / 10,
    isExcluded: rep.isExcluded,
    statusLabel: rep.statusLabel,
  };
}

export function discoverLowestPrices(
  entries: MarketEntry[],
  feedbacks: PlaceFeedbackReport[],
  activeZone: string | null,
  weightOf: ReporterWeightLookup = DEFAULT_REPORTER_WEIGHT,
  now: number = Date.now()
): LowestPriceDeal[] {
  const scopedEntries: MarketEntry[] = [];
  for (const e of entries) {
    if (!activeZone || matchesZoneFilter(e, activeZone)) scopedEntries.push(e);
  }

  type PricedEntry = MarketEntry & { kind: 'price'; price: number };
  const priceEntries: PricedEntry[] = [];
  for (const e of scopedEntries) {
    if (e.kind === 'price' && typeof e.price === 'number' && Number.isFinite(e.price) && e.price > 0) {
      priceEntries.push(e as PricedEntry);
    }
  }

  const byItem = new Map<string, PricedEntry[]>();
  for (const entry of priceEntries) {
    const key = normalizeGeoText(entry.item);
    const list = byItem.get(key) || [];
    list.push(entry);
    byItem.set(key, list);
  }

  const deals: LowestPriceDeal[] = [];

  for (const list of byItem.values()) {
    const points: WeightedPricePoint[] = list.map((e) => ({
      price: e.price,
      weight: 1,
      createdAt: e.createdAt,
    }));
    const band = computeFairBand(points, now);

    for (const entry of list) {
      const placeEval = evaluatePlaceTrust(
        entry.placeName || entry.authorName || '',
        entry.location,
        feedbacks,
        weightOf,
        now
      );

      const { deviationPercent } = classifyByBand(entry.price, band);
      const discountPercent =
        band.median && band.median > 0
          ? Math.round(((band.median - entry.price) / band.median) * 1000) / 10
          : 0;

      const similarLowCount = list.filter((x) => x.price <= entry.price * 1.1).length;
      const isSuspiciousLow = Boolean(
        band.median && band.median > 0 && entry.price < band.median * 0.5 && similarLowCount < 2
      ) || isAnomalousLow(entry.price, band);

      if (discountPercent > 0 || list.length === 1 || deviationPercent <= 0) {
        deals.push({
          id: entry.id,
          item: entry.item,
          category: entry.category || 'عام',
          location: entry.location,
          placeName: entry.placeName,
          price: entry.price,
          medianPrice: band.median,
          p25: band.p25,
          p75: band.p75,
          discountPercent,
          reportsCountForItem: list.length,
          isSuspiciousLow,
          placeTrustScore: placeEval.trustScore,
          isExcludedByCommunity: placeEval.isExcluded,
          entry,
        });
      }
    }
  }

  return deals.sort((a, b) => {
    if (a.isExcludedByCommunity !== b.isExcludedByCommunity) return a.isExcludedByCommunity ? 1 : -1;
    if (a.isSuspiciousLow !== b.isSuspiciousLow) return a.isSuspiciousLow ? 1 : -1;
    if (b.discountPercent !== a.discountPercent) return b.discountPercent - a.discountPercent;
    return a.price - b.price;
  });
}

export function discoverZonePlaces(
  entries: MarketEntry[],
  feedbacks: PlaceFeedbackReport[],
  activeZone: string | null,
  weightOf: ReporterWeightLookup = DEFAULT_REPORTER_WEIGHT,
  now: number = Date.now()
): DiscoveredPlaceSummary[] {
  const scoped: MarketEntry[] = [];
  for (const e of entries) {
    if (!activeZone || matchesZoneFilter(e, activeZone)) {
      scoped.push(e);
      continue;
    }
    const noteText = e.note || '';
    if (noteText && matchesZoneFilter({ location: noteText }, activeZone)) scoped.push(e);
  }

  interface GroupBucket {
    placeName: string;
    location: string;
    entries: MarketEntry[];
    prices: number[];
    items: string[];
  }

  const grouped = new Map<string, GroupBucket>();

  for (const entry of scoped) {
    const rawPlace =
      (entry.placeName && entry.placeName.trim()) ||
      (entry.kind === 'price' ? `${entry.item.trim()} - نقطة بيع` : '');
    if (!rawPlace) continue;
    const key = buildPlaceKey(rawPlace, entry.location);
    const existing = grouped.get(key);
    const trimmedItem = entry.item.trim();

    if (!existing) {
      grouped.set(key, {
        placeName: rawPlace,
        location: entry.location,
        entries: [entry],
        prices:
          entry.kind === 'price' && typeof entry.price === 'number' && entry.price > 0
            ? [entry.price]
            : [],
        items: trimmedItem ? [trimmedItem] : [],
      });
    } else {
      existing.entries.push(entry);
      if (entry.kind === 'price' && typeof entry.price === 'number' && entry.price > 0) {
        existing.prices.push(entry.price);
      }
      if (trimmedItem && existing.items.indexOf(trimmedItem) === -1) existing.items.push(trimmedItem);
    }
  }

  const summaries: DiscoveredPlaceSummary[] = [];
  for (const g of grouped.values()) {
    const trust = evaluatePlaceTrust(g.placeName, g.location, feedbacks, weightOf, now);
    const avgPrice =
      g.prices.length > 0
        ? Math.round((g.prices.reduce((a, b) => a + b, 0) / g.prices.length) * 100) / 100
        : null;
    const lowestPrice = g.prices.length > 0 ? Math.min(...g.prices) : null;

    summaries.push({
      placeKey: trust.placeKey,
      placeName: g.placeName,
      location: g.location,
      entriesCount: g.entries.length,
      avgPrice,
      lowestPrice,
      honestLowCount: trust.honestLowCount,
      fairCount: trust.fairCount,
      expensiveCount: trust.expensiveCount,
      deceptiveCount: trust.deceptiveCount,
      uniqueDeceptiveReporters: trust.uniqueDeceptiveReporters,
      trustScore: trust.trustScore,
      isExcluded: trust.isExcluded,
      statusLabel: trust.statusLabel,
      sampleItems: g.items.slice(0, 5),
    });
  }

  return summaries.sort((a, b) => {
    if (a.isExcluded !== b.isExcluded) return a.isExcluded ? 1 : -1;
    if (b.trustScore !== a.trustScore) return b.trustScore - a.trustScore;
    return b.entriesCount - a.entriesCount;
  });
}
