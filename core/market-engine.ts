export type ReportKind = 'price' | 'have' | 'need';

export type PriceTag = 'عادل' | 'مرتفع' | 'منخفض' | 'شاذ';

export interface MarketEntry {
  id: string;
  kind: ReportKind;
  category: string;
  item: string;
  placeName?: string;
  quantity?: string;
  wantItem?: string;
  location: string;
  price?: number;
  authorName: string;
  authorPeerId: string;
  contact?: string;
  note?: string;
  createdAt: number;
}

export interface AnalyzedPriceReport extends MarketEntry {
  kind: 'price';
  price: number;
  deviationPercent: number;
  tag: PriceTag;
}

export interface ItemPriceSummary {
  item: string;
  category: string;
  median: number | null;
  lowestPrice: number | null;
  highestPrice: number | null;
  cheapestPlace?: string;
  priciestPlace?: string;
  reports: AnalyzedPriceReport[];
}

export interface SmartMatch {
  id: string;
  type: 'direct' | 'reverse';
  summary: string;
  firstParty: MarketEntry;
  secondParty: MarketEntry;
}

export const DEFAULT_CATEGORIES = [
  'بقالة',
  'محاصيل',
  'مغالق',
  'أدوات كهربائية',
  'مراكز تجارية',
];

export const DEFAULT_SAMPLE_ITEMS = [
  'دقيق',
  'سكر',
  'زيت',
  'ذرة',
  'أرز',
  'كابل كهربائي',
  'مفتاح إنارة',
];

export function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

export function getOrCreateLocalPeer(): { peerId: string; defaultName: string } {
  if (typeof window === 'undefined') {
    return { peerId: 'peer-local', defaultName: 'عضو محلي' };
  }
  const storageKey = 'market_radar_local_peer_v1';
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.peerId && parsed?.defaultName) {
        return parsed;
      }
    }
    const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase();
    const peerId = `P2P-${randomPart}`;
    const defaultName = `مستخدم-${randomPart.slice(0, 3)}`;
    const created = { peerId, defaultName };
    window.localStorage.setItem(storageKey, JSON.stringify(created));
    return created;
  } catch {
    return { peerId: 'P2P-LOCAL', defaultName: 'مستخدم محلي' };
  }
}

export function calculateMedian(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100;
  }
  return sorted[mid];
}

export function classifyPrice(price: number, median: number | null): {
  tag: PriceTag;
  deviationPercent: number;
} {
  if (!median || median <= 0) {
    return { tag: 'عادل', deviationPercent: 0 };
  }
  const diffRatio = (price - median) / median;
  const deviationPercent = Math.round(diffRatio * 1000) / 10;

  if (Math.abs(diffRatio) >= 0.35) {
    return { tag: 'شاذ', deviationPercent };
  }
  if (diffRatio > 0.12) {
    return { tag: 'مرتفع', deviationPercent };
  }
  if (diffRatio < -0.12) {
    return { tag: 'منخفض', deviationPercent };
  }
  return { tag: 'عادل', deviationPercent };
}

export function analyzeItemPrices(entries: MarketEntry[], itemName: string): ItemPriceSummary {
  const target = normalizeText(itemName);
  const rawReports = entries.filter(
    (e): e is MarketEntry & { kind: 'price'; price: number } =>
      e.kind === 'price' &&
      typeof e.price === 'number' &&
      !Number.isNaN(e.price) &&
      e.price > 0 &&
      normalizeText(e.item) === target
  );

  const median = calculateMedian(rawReports.map((r) => r.price));

  const reports: AnalyzedPriceReport[] = rawReports
    .map((r): AnalyzedPriceReport => {
      const { tag, deviationPercent } = classifyPrice(r.price, median);
      return {
        ...r,
        kind: 'price' as const,
        category: r.category || 'عام',
        price: r.price,
        deviationPercent,
        tag,
      };
    })
    .sort((a, b) => a.price - b.price);

  const cheapest = reports[0];
  const priciest = reports[reports.length - 1];

  return {
    item: itemName,
    category: cheapest?.category || rawReports[0]?.category || 'عام',
    median,
    lowestPrice: cheapest ? cheapest.price : null,
    highestPrice: priciest ? priciest.price : null,
    cheapestPlace: cheapest ? cheapest.placeName || cheapest.authorName : undefined,
    priciestPlace: priciest ? priciest.placeName || priciest.authorName : undefined,
    reports,
  };
}

export function findSmartMatches(entries: MarketEntry[]): SmartMatch[] {
  const haves = entries.filter((e) => e.kind === 'have');
  const needs = entries.filter((e) => e.kind === 'need');
  const matches: SmartMatch[] = [];
  const seenPairs = new Set<string>();

  for (const need of needs) {
    for (const have of haves) {
      if (need.authorPeerId && have.authorPeerId && need.authorPeerId === have.authorPeerId) {
        continue;
      }

      const sameItem = normalizeText(need.item) === normalizeText(have.item);
      const crossMatch =
        need.wantItem &&
        have.wantItem &&
        normalizeText(need.wantItem) === normalizeText(have.item) &&
        normalizeText(have.wantItem) === normalizeText(need.item);

      if (!sameItem && !crossMatch) continue;

      const pairKey = [need.id, have.id].sort().join('::');
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      matches.push({
        id: pairKey,
        type: crossMatch ? 'reverse' : 'direct',
        summary: crossMatch
          ? `تبادل متكافئ: ${have.item} (${have.authorName}) ↔ ${need.item} (${need.authorName})`
          : `مطابقة مباشرة على (${have.item}): ${have.authorName} يملك و ${need.authorName} يحتاج`,
        firstParty: have,
        secondParty: need,
      });
    }
  }

  return matches;
}
