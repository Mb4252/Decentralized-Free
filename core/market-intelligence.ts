import { MarketEntry, calculateMedian, classifyPrice } from './market-engine';
import { matchesZoneFilter, normalizeGeoText } from './geo-focus';

export type PlaceFeedbackVerdict = 'honest_low' | 'fair' | 'expensive' | 'deceptive';

export interface PlaceFeedbackReport {
  id: string;
  targetPlaceKey: string;
  targetPlaceName: string;
  targetLocation: string;
  targetItem?: string;
  verdict: PlaceFeedbackVerdict;
  reason?: string;
  reporterPeerId: string;
  reporterName: string;
  createdAt: number;
}

export interface LowestPriceDeal {
  id: string;
  item: string;
  category: string;
  location: string;
  placeName?: string;
  price: number;
  medianPrice: number | null;
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
  feedbacks: PlaceFeedbackReport[]
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
      !location ||
      !f.targetLocation ||
      matchesZoneFilter({ location: f.targetLocation }, location);
    if (samePlace && sameLoc) {
      matching.push(f);
    }
  }

  const deceptiveReports: PlaceFeedbackReport[] = [];
  const uniqueDeceptivePeers: string[] = [];
  let honestLowCount = 0;
  let fairCount = 0;
  let expensiveCount = 0;

  for (let i = 0; i < matching.length; i++) {
    const r = matching[i];
    if (r.verdict === 'honest_low') honestLowCount += 1;
    else if (r.verdict === 'fair') fairCount += 1;
    else if (r.verdict === 'expensive') expensiveCount += 1;
    else if (r.verdict === 'deceptive') {
      deceptiveReports.push(r);
      if (r.reporterPeerId && uniqueDeceptivePeers.indexOf(r.reporterPeerId) === -1) {
        uniqueDeceptivePeers.push(r.reporterPeerId);
      }
    }
  }

  const deceptiveCount = deceptiveReports.length;
  const uniqueDeceptiveReporters = uniqueDeceptivePeers.length;
  const isExcluded = uniqueDeceptiveReporters >= DECEPTIVE_EXCLUSION_THRESHOLD;

  const trustScore =
    honestLowCount * 3 +
    fairCount * 2 -
    expensiveCount * 1 -
    deceptiveCount * 4 -
    (isExcluded ? 20 : 0);

  let statusLabel: DiscoveredPlaceSummary['statusLabel'] = 'تحت الرصد';
  if (isExcluded) {
    statusLabel = 'مستبعد (بلاغات خداع)';
  } else if (honestLowCount > 0 && trustScore >= 3) {
    statusLabel = 'معتمد ومخفض';
  } else if (expensiveCount > fairCount + honestLowCount && expensiveCount >= 2) {
    statusLabel = 'مرتفع السعر';
  } else if (fairCount > 0 || trustScore > 0) {
    statusLabel = 'معتمد وعادل';
  }

  return {
    placeKey,
    honestLowCount,
    fairCount,
    expensiveCount,
    deceptiveCount,
    uniqueDeceptiveReporters,
    trustScore,
    isExcluded,
    statusLabel,
  };
}

export function discoverLowestPrices(
  entries: MarketEntry[],
  feedbacks: PlaceFeedbackReport[],
  activeZone: string | null
): LowestPriceDeal[] {
  const scopedEntries: MarketEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!activeZone || matchesZoneFilter(e, activeZone)) {
      scopedEntries.push(e);
    }
  }

  type PricedEntry = MarketEntry & { kind: 'price'; price: number };
  const priceEntries: PricedEntry[] = [];
  for (let i = 0; i < scopedEntries.length; i++) {
    const e = scopedEntries[i];
    if (
      e.kind === 'price' &&
      typeof e.price === 'number' &&
      Number.isFinite(e.price) &&
      e.price > 0
    ) {
      priceEntries.push(e as PricedEntry);
    }
  }

  const byItem = new Map<string, PricedEntry[]>();
  for (let i = 0; i < priceEntries.length; i++) {
    const entry = priceEntries[i];
    const key = normalizeGeoText(entry.item);
    const list = byItem.get(key) || [];
    list.push(entry);
    byItem.set(key, list);
  }

  const deals: LowestPriceDeal[] = [];
  const itemGroups = Array.from(byItem.values());

  for (let g = 0; g < itemGroups.length; g++) {
    const list = itemGroups[g];
    const prices = list.map((x) => x.price);
    const medianPrice = calculateMedian(prices);

    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      const placeEval = evaluatePlaceTrust(
        entry.placeName || entry.authorName || '',
        entry.location,
        feedbacks
      );

      const { deviationPercent } = classifyPrice(entry.price, medianPrice);
      const discountPercent =
        medianPrice && medianPrice > 0
          ? Math.round(((medianPrice - entry.price) / medianPrice) * 1000) / 10
          : 0;

      const similarLowCount = list.filter((x) => x.price <= entry.price * 1.1).length;
      const isSuspiciousLow = Boolean(
        medianPrice &&
          medianPrice > 0 &&
          entry.price < medianPrice * 0.5 &&
          similarLowCount < 2
      );

      if (discountPercent > 0 || list.length === 1 || deviationPercent <= 0) {
        deals.push({
          id: entry.id,
          item: entry.item,
          category: entry.category || 'عام',
          location: entry.location,
          placeName: entry.placeName,
          price: entry.price,
          medianPrice,
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
    if (a.isExcludedByCommunity !== b.isExcludedByCommunity) {
      return a.isExcludedByCommunity ? 1 : -1;
    }
    if (a.isSuspiciousLow !== b.isSuspiciousLow) {
      return a.isSuspiciousLow ? 1 : -1;
    }
    if (b.discountPercent !== a.discountPercent) {
      return b.discountPercent - a.discountPercent;
    }
    return a.price - b.price;
  });
}

export function discoverZonePlaces(
  entries: MarketEntry[],
  feedbacks: PlaceFeedbackReport[],
  activeZone: string | null
): DiscoveredPlaceSummary[] {
  const scoped: MarketEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!activeZone) {
      scoped.push(e);
      continue;
    }
    if (matchesZoneFilter(e, activeZone)) {
      scoped.push(e);
      continue;
    }
    const noteText = e.note || '';
    if (noteText && matchesZoneFilter({ location: noteText }, activeZone)) {
      scoped.push(e);
    }
  }

  interface GroupBucket {
    placeName: string;
    location: string;
    entries: MarketEntry[];
    prices: number[];
    items: string[];
  }

  const grouped = new Map<string, GroupBucket>();

  for (let i = 0; i < scoped.length; i++) {
    const entry = scoped[i];
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
      if (trimmedItem && existing.items.indexOf(trimmedItem) === -1) {
        existing.items.push(trimmedItem);
      }
    }
  }

  const summaries: DiscoveredPlaceSummary[] = [];
  const buckets = Array.from(grouped.values());

  for (let i = 0; i < buckets.length; i++) {
    const g = buckets[i];
    const trust = evaluatePlaceTrust(g.placeName, g.location, feedbacks);
    const avgPrice =
      g.prices.length > 0
        ? Math.round((g.prices.reduce((a, b) => a + b, 0) / g.prices.length) * 100) / 100
        : null;
    const lowestPrice = g.prices.length > 0 ? Math.min.apply(null, g.prices) : null;

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
