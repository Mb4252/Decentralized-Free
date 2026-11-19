'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  MarketEntry,
  SmartMatch,
  analyzeItemPrices,
  findSmartMatches,
  getOrCreateLocalPeer,
} from '@/core/market-engine';
import {
  NodeStatus,
  attachChecksum,
  mergeVerifiedEntries,
} from '@/core/p2p-node';

interface AppContextValue {
  entries: MarketEntry[];
  priceReports: MarketEntry[];
  barterOffers: MarketEntry[];
  matches: SmartMatch[];
  localPeer: { peerId: string; defaultName: string };
  nodeStatus: NodeStatus;
  addEntry: (
    entry: Omit<MarketEntry, 'id' | 'createdAt' | 'authorPeerId'> & { authorPeerId?: string }
  ) => MarketEntry;
  removeEntry: (id: string) => void;
  exportBundleJson: () => string;
  importBundleJson: (rawJson: string) => {
    ok: boolean;
    importedCount: number;
    rejectedCount: number;
    error?: string;
  };
  getItemAnalysis: (itemName: string) => ReturnType<typeof analyzeItemPrices>;
}

const STORAGE_KEY = 'market_radar_entries_v1';
const CHANNEL_NAME = 'market_radar_sync_channel_v1';

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<MarketEntry[]>([]);
  const [localPeer, setLocalPeer] = useState<{ peerId: string; defaultName: string }>({
    peerId: 'P2P-LOCAL',
    defaultName: 'مستخدم محلي',
  });
  const [nodeStatus, setNodeStatus] = useState<NodeStatus>({
    peerId: 'P2P-LOCAL',
    connectedPeers: 0,
    mode: 'local-gossip',
    lastSyncAt: null,
    verifiedCount: 0,
    rejectedCount: 0,
  });

  useEffect(() => {
    const peer = getOrCreateLocalPeer();
    setLocalPeer(peer);
    setNodeStatus((prev) => ({ ...prev, peerId: peer.peerId }));

    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const { merged, rejectedCount } = mergeVerifiedEntries([], parsed);
          setEntries(merged);
          setNodeStatus((prev) => ({
            ...prev,
            verifiedCount: merged.length,
            rejectedCount: prev.rejectedCount + rejectedCount,
            lastSyncAt: Date.now(),
          }));
        }
      }
    } catch {
      // تجاهل أخطاء التخزين غير المدعوم
    }

    let channel: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event) => {
        if (event.data?.type === 'SYNC_ENTRIES' && Array.isArray(event.data.payload)) {
          setEntries((current) => {
            const { merged, rejectedCount } = mergeVerifiedEntries(current, event.data.payload);
            try {
              window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
            } catch {
              // تجاهل
            }
            setNodeStatus((prev) => ({
              ...prev,
              verifiedCount: merged.length,
              rejectedCount: prev.rejectedCount + rejectedCount,
              lastSyncAt: Date.now(),
            }));
            return merged;
          });
        }
      };
    }

    return () => {
      channel?.close();
    };
  }, []);

  const persistAndBroadcast = (next: MarketEntry[]) => {
    setEntries(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // تجاهل
    }
    setNodeStatus((prev) => ({
      ...prev,
      verifiedCount: next.length,
      lastSyncAt: Date.now(),
    }));
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.postMessage({ type: 'SYNC_ENTRIES', payload: next });
      channel.close();
    }
  };

  const addEntry: AppContextValue['addEntry'] = (input) => {
    const base: MarketEntry = {
      ...input,
      id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      authorName: input.authorName?.trim() || localPeer.defaultName,
      authorPeerId: input.authorPeerId || localPeer.peerId,
      createdAt: Date.now(),
    };
    const verified = attachChecksum(base);
    const next = [verified, ...entries];
    persistAndBroadcast(next);
    return verified;
  };

  const removeEntry = (id: string) => {
    const next = entries.filter((item) => item.id !== id);
    persistAndBroadcast(next);
  };

  const exportBundleJson = () => {
    const signedEntries = entries.map((e) => attachChecksum(e));
    return JSON.stringify(
      {
        version: 2,
        protocol: 'fair-price-barter-gossip-v1',
        exportedAt: new Date().toISOString(),
        entries: signedEntries,
      },
      null,
      2
    );
  };

  const importBundleJson = (rawJson: string) => {
    try {
      const parsed = JSON.parse(rawJson);
      const incoming: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.entries)
        ? parsed.entries
        : [];

      if (!incoming.length) {
        return {
          ok: false,
          importedCount: 0,
          rejectedCount: 0,
          error: 'لم يتم العثور على عناصر صالحة في البيانات.',
        };
      }

      const { merged, addedCount, rejectedCount } = mergeVerifiedEntries(entries, incoming);
      persistAndBroadcast(merged);
      setNodeStatus((prev) => ({
        ...prev,
        rejectedCount: prev.rejectedCount + rejectedCount,
      }));
      return { ok: true, importedCount: addedCount, rejectedCount };
    } catch {
      return {
        ok: false,
        importedCount: 0,
        rejectedCount: 0,
        error: 'صيغة JSON غير صحيحة.',
      };
    }
  };

  const priceReports = useMemo(() => entries.filter((e) => e.kind === 'price'), [entries]);
  const barterOffers = useMemo(() => entries.filter((e) => e.kind === 'have' || e.kind === 'need'), [entries]);
  const matches = useMemo(() => findSmartMatches(entries), [entries]);

  const getItemAnalysis = (itemName: string) => analyzeItemPrices(entries, itemName);

  return (
    <AppContext.Provider
      value={{
        entries,
        priceReports,
        barterOffers,
        matches,
        localPeer,
        nodeStatus,
        addEntry,
        removeEntry,
        exportBundleJson,
        importBundleJson,
        getItemAnalysis,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp يجب أن يُستخدم داخل AppProvider');
  }
  return ctx;
}
