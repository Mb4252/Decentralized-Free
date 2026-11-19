import { MarketEntry } from './market-engine';

export type GeoFocusMode = 'auto' | 'locked' | 'all';

export interface ZoneFrequency {
  zone: string;
  normalizedKey: string;
  count: number;
  weightedScore: number;
  ownEntryCount: number;
  lastSeenAt: number;
}

export interface GeoInferenceResult {
  stats: ZoneFrequency[];
  detectedZone: string | null;
  detectedCount: number;
  shouldSuggestLock: boolean;
  activeZone: string | null;
}

export function normalizeGeoText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripGeoPrefixes(normalized: string): string {
  const cleaned = normalized
    .replace(/^(حي|منطقه|منطقة|محله|محلة|سوق|مربع|حاره|حارة)\s+/g, '')
    .replace(/\s+(حي|منطقه|منطقة|محله|محلة|سوق|مربع|حاره|حارة)\s+/g, ' ')
    .trim();
  return cleaned || normalized;
}

export function extractPrimaryZoneLabel(entry: Pick<MarketEntry, 'location' | 'placeName'>): string {
  const rawLocation = (entry.location || '').trim();
  const rawPlace = (entry.placeName || '').trim();
  const combined = rawLocation || rawPlace;
  if (!combined) return '';

  const parts = combined
    .split(/[-–—/|،,]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0]} - ${parts[1]}`;
  }

  if (rawLocation && rawPlace && normalizeGeoText(rawLocation) !== normalizeGeoText(rawPlace)) {
    const placePart = rawPlace.split(/[-–—/|،,]+/)[0]?.trim();
    if (placePart && !normalizeGeoText(rawLocation).includes(normalizeGeoText(placePart))) {
      return `${rawLocation} - ${placePart}`;
    }
  }

  return parts[0] || combined;
}

export function analyzeUserGeoActivity(
  entries: MarketEntry[],
  peerId: string
): Omit<GeoInferenceResult, 'activeZone'> {
  const map = new Map<string, ZoneFrequency>();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  for (const entry of entries) {
    const label = extractPrimaryZoneLabel(entry);
    if (!label) continue;

    const normalized = normalizeGeoText(label);
    const key = stripGeoPrefixes(normalized);
    if (!key) continue;

    const isOwn = Boolean(peerId && entry.authorPeerId === peerId);
    const ageDays = Math.max(0, (now - (entry.createdAt || now)) / dayMs);
    const recencyFactor = Math.max(0.5, 1.5 - Math.min(ageDays, 30) / 30);
    const weight = (isOwn ? 2 : 1) * recencyFactor;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        zone: label,
        normalizedKey: key,
        count: 1,
        weightedScore: weight,
        ownEntryCount: isOwn ? 1 : 0,
        lastSeenAt: entry.createdAt || now,
      });
    } else {
      existing.count += 1;
      existing.weightedScore += weight;
      if (isOwn) existing.ownEntryCount += 1;
      if ((entry.createdAt || 0) >= existing.lastSeenAt) {
        existing.lastSeenAt = entry.createdAt || now;
        if (isOwn || existing.ownEntryCount === 0) {
          existing.zone = label;
        }
      }
    }
  }

  const stats = Array.from(map.values()).sort((a, b) => {
    if (b.weightedScore !== a.weightedScore) return b.weightedScore - a.weightedScore;
    if (b.count !== a.count) return b.count - a.count;
    return b.lastSeenAt - a.lastSeenAt;
  });

  const top = stats[0] || null;
  const totalCount = stats.reduce((acc, item) => acc + item.count, 0);

  const detectedZone = top ? top.zone : null;
  const detectedCount = top ? top.count : 0;

  const shouldSuggestLock = Boolean(
    top &&
      top.count >= 2 &&
      (top.ownEntryCount >= 2 || (totalCount >= 3 && top.count / totalCount >= 0.5))
  );

  return {
    stats,
    detectedZone,
    detectedCount,
    shouldSuggestLock,
  };
}

export function matchesZoneFilter(
  entry: Pick<MarketEntry, 'location' | 'placeName'>,
  targetZone: string | null
): boolean {
  if (!targetZone || !targetZone.trim()) return true;

  const targetNorm = normalizeGeoText(targetZone);
  const targetCore = stripGeoPrefixes(targetNorm);
  const targetTokens = targetCore.split(/\s+/).filter((t) => t.length >= 2);

  const entryRaw = `${entry.location || ''} ${entry.placeName || ''}`.trim();
  if (!entryRaw) return false;

  const entryNorm = normalizeGeoText(entryRaw);
  const entryCore = stripGeoPrefixes(entryNorm);

  if (entryNorm.includes(targetNorm) || entryCore.includes(targetCore)) {
    return true;
  }

  if (targetTokens.length > 0) {
    const matchedTokens = targetTokens.filter((tok) => entryCore.includes(tok));
    if (matchedTokens.length === targetTokens.length) {
      return true;
    }
  }

  return false;
}

export function filterEntriesByGeoFocus(
  entries: MarketEntry[],
  mode: GeoFocusMode,
  focusedZone: string | null,
  detectedZone: string | null
): { filteredEntries: MarketEntry[]; activeZone: string | null } {
  if (mode === 'all') {
    return { filteredEntries: entries, activeZone: null };
  }

  const targetZone = mode === 'locked' ? focusedZone || detectedZone : null;
  if (!targetZone) {
    return { filteredEntries: entries, activeZone: null };
  }

  const matched = entries.filter((entry) => matchesZoneFilter(entry, targetZone));
  return {
    filteredEntries: matched,
    activeZone: targetZone,
  };
}
