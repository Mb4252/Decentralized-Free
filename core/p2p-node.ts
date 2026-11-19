import { joinRoom } from 'trystero/torrent';
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

export interface P2PSyncMessage {
  type: 'FULL_STATE' | 'NEW_ENTRY' | 'DELETE_ENTRY' | 'REQUEST_STATE';
  entries?: MarketEntry[];
  entry?: MarketEntry;
  deletedId?: string;
  senderPeerId: string;
  sentAt: number;
}

const DEFAULT_APP_ID = 'fair-price-barter-radar-v1';
const DEFAULT_ROOM_ID = 'sudan-community-market-mesh-v1';

export function computeEntryChecksum(
  entry: Omit<MarketEntry, 'id' | 'createdAt'> & { id: string; createdAt: number }
): string {
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
  if (typeof item.item !== 'string' || item.item.trim().length === 0 || item.item.length > 120) {
    return false;
  }
  if (
    typeof item.location !== 'string' ||
    item.location.trim().length === 0 ||
    item.location.length > 120
  ) {
    return false;
  }
  if (
    typeof item.authorName !== 'string' ||
    item.authorName.trim().length === 0 ||
    item.authorName.length > 80
  ) {
    return false;
  }
  if (
    typeof item.authorPeerId !== 'string' ||
    item.authorPeerId.trim().length === 0 ||
    item.authorPeerId.length > 60
  ) {
    return false;
  }
  if (typeof item.createdAt !== 'number' || !Number.isFinite(item.createdAt) || item.createdAt <= 0) {
    return false;
  }

  if (item.kind === 'price') {
    if (
      typeof item.price !== 'number' ||
      !Number.isFinite(item.price) ||
      item.price <= 0 ||
      item.price > 1_000_000_000_000
    ) {
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

interface MeshCallbacks {
  peerId: string;
  getCurrentEntries: () => MarketEntry[];
  onPeersChange: (connectedPeers: number, mode: 'local-gossip' | 'webrtc-mesh') => void;
  onReceiveMessage: (msg: P2PSyncMessage) => void;
}

export class MeshP2PNetwork {
  private room: ReturnType<typeof joinRoom> | null = null;
  private sendSync: ((data: P2PSyncMessage, targetPeerId?: string | string[] | null) => Promise<void[]>) | null = null;
  private connectedPeerIds = new Set<string>();
  private callbacks: MeshCallbacks;

  constructor(callbacks: MeshCallbacks) {
    this.callbacks = callbacks;
  }

  public start(): void {
    if (typeof window === 'undefined') return;

    try {
      const room = joinRoom({ appId: DEFAULT_APP_ID }, DEFAULT_ROOM_ID);
      this.room = room;

      const [sendMsg, getMsg] = room.makeAction<P2PSyncMessage>('marketSync');
      this.sendSync = sendMsg;

      room.onPeerJoin((remotePeerId) => {
        this.connectedPeerIds.add(remotePeerId);
        this.callbacks.onPeersChange(this.connectedPeerIds.size, 'webrtc-mesh');

        const currentEntries = this.callbacks.getCurrentEntries();
        if (currentEntries.length > 0 && this.sendSync) {
          void this.sendSync(
            {
              type: 'FULL_STATE',
              entries: currentEntries,
              senderPeerId: this.callbacks.peerId,
              sentAt: Date.now(),
            },
            remotePeerId
          );
        }
      });

      room.onPeerLeave((remotePeerId) => {
        this.connectedPeerIds.delete(remotePeerId);
        this.callbacks.onPeersChange(
          this.connectedPeerIds.size,
          this.connectedPeerIds.size > 0 ? 'webrtc-mesh' : 'local-gossip'
        );
      });

      getMsg((data, remotePeerId) => {
        if (!data || typeof data !== 'object' || !data.type) return;

        if (data.type === 'REQUEST_STATE') {
          const currentEntries = this.callbacks.getCurrentEntries();
          if (currentEntries.length > 0 && this.sendSync) {
            void this.sendSync(
              {
                type: 'FULL_STATE',
                entries: currentEntries,
                senderPeerId: this.callbacks.peerId,
                sentAt: Date.now(),
              },
              remotePeerId
            );
          }
          return;
        }

        this.callbacks.onReceiveMessage(data);
      });

      void sendMsg({
        type: 'REQUEST_STATE',
        senderPeerId: this.callbacks.peerId,
        sentAt: Date.now(),
      });
    } catch {
      this.callbacks.onPeersChange(0, 'local-gossip');
    }
  }

  public broadcastNewEntry(entry: MarketEntry): void {
    if (!this.sendSync) return;
    void this.sendSync({
      type: 'NEW_ENTRY',
      entry: attachChecksum(entry),
      senderPeerId: this.callbacks.peerId,
      sentAt: Date.now(),
    });
  }

  public broadcastDeleteEntry(id: string): void {
    if (!this.sendSync) return;
    void this.sendSync({
      type: 'DELETE_ENTRY',
      deletedId: id,
      senderPeerId: this.callbacks.peerId,
      sentAt: Date.now(),
    });
  }

  public broadcastFullState(entries: MarketEntry[]): void {
    if (!this.sendSync) return;
    void this.sendSync({
      type: 'FULL_STATE',
      entries: entries.map((e) => attachChecksum(e)),
      senderPeerId: this.callbacks.peerId,
      sentAt: Date.now(),
    });
  }

  public stop(): void {
    this.connectedPeerIds.clear();
    if (this.room) {
      void this.room.leave();
      this.room = null;
    }
    this.sendSync = null;
  }
}
