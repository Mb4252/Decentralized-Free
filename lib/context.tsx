'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  MarketEntry,
  SmartMatch,
  analyzeItemPrices,
  findSmartMatches,
  getOrCreateLocalPeer,
} from '@/core/market-engine';
import {
  MeshP2PNetwork,
  NodeStatus,
  P2PSyncMessage,
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
  const entriesRef = useRef<MarketEntry[]>([]);
  const meshRef = useRef<MeshP2PNetwork | null>(null);

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
    entriesRef.current = entries;
  }, [entries]);

  const writeLocalStorage = useCallback((list: MarketEntry[]) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      // تجاهل أخطاء التخزين غير المدعوم
    }
  }, []);

  const broadcastTabChannel = useCallback((list: MarketEntry[]) => {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.postMessage({ type: 'SYNC_ENTRIES', payload: list });
      channel.close();
    }
  }, []);

  const applyIncomingEntries = useCallback(
    (incoming: unknown[], syncToMesh: boolean) => {
      setEntries((current) => {
        const { merged, addedCount, rejectedCount } = mergeVerifiedEntries(current, incoming);
        writeLocalStorage(merged);
        entriesRef.current = merged;

        setNodeStatus((prev) => ({
          ...prev,
          verifiedCount: merged.length,
          rejectedCount: prev.rejectedCount + rejectedCount,
          lastSyncAt: Date.now(),
        }));

        if (addedCount > 0) {
          broadcastTabChannel(merged);
          if (syncToMesh) {
            meshRef.current?.broadcastFullState(merged);
          }
        }

        return merged;
      });
    },
    [broadcastTabChannel, writeLocalStorage]
  );

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
          entriesRef.current = merged;
          writeLocalStorage(merged);
          setNodeStatus((prev) => ({
            ...prev,
            verifiedCount: merged.length,
            rejectedCount: prev.rejectedCount + rejectedCount,
            lastSyncAt: Date.now(),
          }));
        }
      }
    } catch {
      // تجاهل أخطاء التخزين
    }

    let channel: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (event) => {
        if (event.data?.type === 'SYNC_ENTRIES' && Array.isArray(event.data.payload)) {
          applyIncomingEntries(event.data.payload, false);
        }
      };
    }

    const mesh = new MeshP2PNetwork({
      peerId: peer.peerId,
      getCurrentEntries: () => entriesRef.current,
      onPeersChange: (connectedPeers, mode) => {
        setNodeStatus((prev) => ({
          ...prev,
          connectedPeers,
          mode,
          lastSyncAt: Date.now(),
        }));
      },
      onReceiveMessage: (msg: P2PSyncMessage) => {
        if (msg.type === 'FULL_STATE' && Array.isArray(msg.entries)) {
          applyIncomingEntries(msg.entries, false);
        } else if (msg.type === 'NEW_ENTRY' && msg.entry) {
          applyIncomingEntries([msg.entry], false);
        } else if (msg.type === 'DELETE_ENTRY' && typeof msg.deletedId === 'string') {
          setEntries((current) => {
            const next = current.filter((item) => item.id !== msg.deletedId);
            writeLocalStorage(next);
            entriesRef.current = next;
            broadcastTabChannel(next);
            setNodeStatus((prev) => ({
              ...prev,
              verifiedCount: next.length,
              lastSyncAt: Date.now(),
            }));
            return next;
          });
        }
      },
    });

    meshRef.current = mesh;
    mesh.start();

    return () => {
      channel?.close();
      mesh.stop();
      meshRef.current = null;
    };
  }, [applyIncomingEntries, broadcastTabChannel, writeLocalStorage]);

  const addEntry: AppContextValue['addEntry'] = (input) => {
    const base: MarketEntry = {
      ...input,
      id: `entry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      authorName: input.authorName?.trim() || localPeer.defaultName,
      authorPeerId: input.authorPeerId || localPeer.peerId,
      createdAt: Date.now(),
    };

    const verified = attachChecksum(base);
    const next = [verified, ...entriesRef.current];
    setEntries(next);
    entriesRef.current = next;
    writeLocalStorage(next);
    broadcastTabChannel(next);
    meshRef.current?.broadcastNewEntry(verified);

    setNodeStatus((prev) => ({
      ...prev,
      verifiedCount: next.length,
      lastSyncAt: Date.now(),
    }));

    return verified;
  };

  const removeEntry = (id: string) => {
    const next = entriesRef.current.filter((item) => item.id !== id);
    setEntries(next);
    entriesRef.current = next;
    writeLocalStorage(next);
    broadcastTabChannel(next);
    meshRef.current?.broadcastDeleteEntry(id);

    setNodeStatus((prev) => ({
      ...prev,
      verifiedCount: next.length,
      lastSyncAt: Date.now(),
    }));
  };

  const exportBundleJson = () => {
    const signedEntries = entriesRef.current.map((e) => attachChecksum(e));
    return JSON.stringify(
      {
        version: 2,
        protocol: 'fair-price-barter-webrtc-gossip-v1',
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

      const { merged, addedCount, rejectedCount } = mergeVerifiedEntries(entriesRef.current, incoming);
      setEntries(merged);
      entriesRef.current = merged;
      writeLocalStorage(merged);
      broadcastTabChannel(merged);
      if (addedCount > 0) {
        meshRef.current?.broadcastFullState(merged);
      }

      setNodeStatus((prev) => ({
        ...prev,
        verifiedCount: merged.length,
        rejectedCount: prev.rejectedCount + rejectedCount,
        lastSyncAt: Date.now(),
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
  const barterOffers = useMemo(
    () => entries.filter((e) => e.kind === 'have' || e.kind === 'need'),
    [entries]
  );
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
