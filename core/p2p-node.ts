import { MarketEntry } from './market-engine';

export interface VerifiedEntry extends MarketEntry {
  checksum: string;
}

export interface NodeStatus {
  peerId: string;
  connectedPeers: number;
  mode: 'local-gossip' | 'webrtc-mesh';
  lastSyncAt: number | null;
  verifiedCount: number;
  rejectedCount: number;
}

export function computeEntryChecksum(entry: Omit<MarketEntry, 'id' | 'createdAt'> & { id: string; createdAt: number }): string {
  const payload = [
    entry.id,
    entry.kind,
    (entry.category || '').trim().toLowerCase(),
    (entry.item || '').trim().toLowerCase(),
    (entry.placeName || '').trim().toLowerCase(),
    (entry.location || '').trim().toLowerCase(),
    entry.price ?? '',
    (entry.quantity || '').trim(),
    (entry.wantItem || '').trim().toLowerCase(),
    (entry.authorPeerId || '').trim(),
    String(entry.createdAt),
  ].join('|');

  let hash = 2166136261;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `chk-${(hash >>> 0).toString(16)}`;
}

export function attachChecksum(entry: MarketEntry): VerifiedEntry {
  return {
    ...entry,
    checksum: computeEntryChecksum(entry),
  };
}

export function validateMarketEntry(candidate: unknown): candidate is MarketEntry {
  if (!candidate || typeof candidate !== 'object') return false;
  const item = candidate as Record<string, unknown>;

  if (typeof item.id !== 'string' || item.id.trim().length < 3) return false;
  if (item.kind !== 'price' && item.kind !== 'have' && item.kind !== 'need') return false;
  if (typeof item.item !== 'string' || item.item.trim().length === 0 || item.item.length > 120) return false;
  if (typeof item.location !== 'string' || item.location.trim().length === 0 || item.location.length > 120) return false;
  if (typeof item.authorName !== 'string' || item.authorName.trim().length === 0 || item.authorName.length > 80) return false;
  if (typeof item.authorPeerId !== 'string' || item.authorPeerId.trim().length === 0 || item.authorPeerId.length > 60) return false;
  if (typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt) || item.createdAt <= 0) return false;

  if (item.kind === 'price') {
    if (typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price <= 0 || item.price > 1_000_000_000_000) {
      return false;
    }
  }

  if (typeof (item as { checksum?: unknown }).checksum === 'string') {
    const expected = computeEntryChecksum(item as unknown as MarketEntry);
    if ((item as { checksum: string }).checksum !== expected) {
      return false;
    }
  }

  return true;
}

export function mergeVerifiedEntries(
  current: MarketEntry[],
  incoming: unknown[]
): { merged: MarketEntry[]; addedCount: number; rejectedCount: number } {
  const byId = new Map<string, MarketEntry>();
  for (const entry of current) {
    byId.set(entry.id, entry);
  }

  let addedCount = 0;
  let rejectedCount = 0;

  for (const raw of incoming) {
    if (!validateMarketEntry(raw)) {
      rejectedCount += 1;
      continue;
    }
    if (!byId.has(raw.id)) {
      byId.set(raw.id, attachChecksum(raw));
      addedCount += 1;
    }
  }

  const merged = Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
  return { merged, addedCount, rejectedCount };
}
