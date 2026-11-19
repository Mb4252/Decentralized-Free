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
  BarterMatch,
  MarketEntry,
  PriceSummary,
  buildBarterMatches,
  buildPriceSummaries,
  createMarketEntry,
  loadInitialEntries,
  saveEntriesToStorage,
} from '@/core/market-engine';
import {
  MeshP2PNetwork,
  NodeStatus,
  P2PSyncMessage,
  attachChecksum,
  mergeVerifiedEntries,
  validateMarketEntry,
} from '@/core/p2p-node';
import {
  GeoFocusMode,
  ZoneFrequency,
  analyzeUserGeoActivity,
  filterEntriesByGeoFocus,
} from '@/core/geo-focus';

const PEER_ID_STORAGE_KEY = 'fair_price_barter_peer_id_v1';
const GEO_FOCUS_STORAGE_KEY = 'fair_price_barter_geo_focus_v1';

interface NewEntryInput {
  kind: 'price' | 'have' | 'need';
  category: string;
  item: string;
  placeName?: string;
  location: string;
  price?: number;
  quantity?: string;
  wantItem?: string;
  notes?: string;
  authorName?: string;
}

interface MarketContextValue {
  entries: MarketEntry[];
  allEntries: MarketEntry[];
  priceSummaries: PriceSummary[];
  barterMatches: BarterMatch[];
  nodeStatus: NodeStatus;
  focusMode: GeoFocusMode;
  focusedZone: string | null;
  detectedZone: string | null;
  detectedCount: number;
  shouldSuggestLock: boolean;
  activeZone: string | null;
  zoneStats: ZoneFrequency[];
  setFocusedZone: (zone: string | null) => void;
  setFocusMode: (mode: GeoFocusMode) => void;
  lockToDetectedZone: () => void;
  clearGeoFocus: () => void;
  addEntry: (input: NewEntryInput) => MarketEntry | null;
  deleteEntry: (id: string) => void;
  importJsonBundle: (rawJson: string) => {
    ok: boolean;
    message: string;
    addedCount: number;
    rejectedCount: number;
  };
  exportJsonBundle: () => string;
  resetDemoData: () => void;
}

const MarketContext = createContext<MarketContextValue | null>(null);

function getOrCreatePeerId(): string {
  if (typeof window === 'undefined') return 'peer-ssr';
  try {
    const existing = window.localStorage.getItem(PEER_ID_STORAGE_KEY);
    if (existing && existing.trim().length >= 4) return existing;
    const generated = `peer-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36).slice(-4)}`;
    window.localStorage.setItem(PEER_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    return `peer-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function loadSavedGeoFocus(): { mode: GeoFocusMode; focusedZone: string | null } {
  if (typeof window === 'undefined') {
    return { mode: 'auto', focusedZone: null };
  }
  try {
    const raw = window.localStorage.getItem(GEO_FOCUS_STORAGE_KEY);
    if (!raw) return { mode: 'auto', focusedZone: null };
    const parsed = JSON.parse(raw) as { mode?: unknown; focusedZone?: unknown };
    const mode: GeoFocusMode =
      parsed.mode === 'locked' || parsed.mode === 'all' || parsed.mode === 'auto'
        ? parsed.mode
        : 'auto';
    const focusedZone =
      typeof parsed.focusedZone === 'string' && parsed.focusedZone.trim().length > 0
        ? parsed.focusedZone.trim()
        : null;
    return { mode, focusedZone };
  } catch {
    return { mode: 'auto', focusedZone: null };
  }
}

export function MarketProvider({ children }: { children: React.ReactNode }) {
  const [peerId] = useState<string>(() => getOrCreatePeerId());
  const [entries, setEntries] = useState<MarketEntry[]>(() => loadInitialEntries());
  const [focusMode, setFocusModeState] = useState<GeoFocusMode>(() => loadSavedGeoFocus().mode);
  const [focusedZone, setFocusedZoneState] = useState<string | null>(
    () => loadSavedGeoFocus().focusedZone
  );

  const [nodeStatus, setNodeStatus] = useState<NodeStatus>({
    peerId,
    connectedPeers: 0,
    mode: 'local-gossip',
    lastSyncAt: null,
    verifiedCount: 0,
    rejectedCount: 0,
  });

  const entriesRef = useRef<MarketEntry[]>(entries);
  entriesRef.current = entries;

  const p2pRef = useRef<MeshP2PNetwork | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    saveEntriesToStorage(entries);
  }, [entries]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        GEO_FOCUS_STORAGE_KEY,
        JSON.stringify({ mode: focusMode, focusedZone })
      );
    } catch {
      // تجاهل أخطاء التخزين المحلي
    }
  }, [focusMode, focusedZone]);

  const applyIncomingMessage = useCallback((msg: P2PSyncMessage) => {
    if (!msg || msg.senderPeerId === peerId) return;

    if (msg.type === 'NEW_ENTRY' && msg.entry) {
      if (!validateMarketEntry(msg.entry)) {
        setNodeStatus((prev) => ({ ...prev, rejectedCount: prev.rejectedCount + 1 }));
        return;
      }
      const verified = attachChecksum(msg.entry);
      setEntries((prev) => {
        if (prev.some((item) => item.id === verified.id)) return prev;
        return [verified, ...prev].sort((a, b) => b.createdAt - a.createdAt);
      });
      setNodeStatus((prev) => ({
        ...prev,
        lastSyncAt: Date.now(),
        verifiedCount: prev.verifiedCount + 1,
      }));
      return;
    }

    if (msg.type === 'DELETE_ENTRY' && msg.deletedId) {
      setEntries((prev) => prev.filter((item) => item.id !== msg.deletedId));
      setNodeStatus((prev) => ({ ...prev, lastSyncAt: Date.now() }));
      return;
    }

    if (msg.type === 'FULL_STATE' && Array.isArray(msg.entries)) {
      setEntries((prev) => {
        const result = mergeVerifiedEntries(prev, msg.entries || []);
        setNodeStatus((st) => ({
          ...st,
          lastSyncAt: Date.now(),
          verifiedCount: st.verifiedCount + result.addedCount,
          rejectedCount: st.rejectedCount + result.rejectedCount,
        }));
        return result.merged;
      });
    }
  }, [peerId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if ('BroadcastChannel' in window) {
      const bc = new BroadcastChannel('fair-price-barter-local-bus');
      channelRef.current = bc;
      bc.onmessage = (event: MessageEvent<P2PSyncMessage>) => {
        applyIncomingMessage(event.data);
      };
    }

    const mesh = new MeshP2PNetwork({
      peerId,
      getCurrentEntries: () => entriesRef.current,
      onPeersChange: (connectedPeers, mode) => {
        setNodeStatus((prev) => ({
          ...prev,
          connectedPeers,
          mode,
        }));
      },
      onReceiveMessage: applyIncomingMessage,
    });

    p2pRef.current = mesh;
    mesh.start();

    return () => {
      mesh.stop();
      p2pRef.current = null;
      if (channelRef.current) {
        channelRef.current.close();
        channelRef.current = null;
      }
    };
  }, [peerId, applyIncomingMessage]);

  const setFocusedZone = useCallback((zone: string | null) => {
    const cleaned = zone && zone.trim().length > 0 ? zone.trim() : null;
    setFocusedZoneState(cleaned);
    if (cleaned) {
      setFocusModeState('locked');
    } else {
      setFocusModeState('all');
    }
  }, []);

  const setFocusMode = useCallback((mode: GeoFocusMode) => {
    setFocusModeState(mode);
    if (mode === 'all') {
      setFocusedZoneState(null);
    }
  }, []);

  const geoInference = useMemo(
    () => analyzeUserGeoActivity(entries, peerId),
    [entries, peerId]
  );

  const lockToDetectedZone = useCallback(() => {
    if (geoInference.detectedZone) {
      setFocusedZoneState(geoInference.detectedZone);
      setFocusModeState('locked');
    }
  }, [geoInference.detectedZone]);

  const clearGeoFocus = useCallback(() => {
    setFocusedZoneState(null);
    setFocusModeState('all');
  }, []);

  const { filteredEntries, activeZone } = useMemo(
    () =>
      filterEntriesByGeoFocus(
        entries,
        focusMode,
        focusedZone,
        geoInference.detectedZone
      ),
    [entries, focusMode, focusedZone, geoInference.detectedZone]
  );

  const addEntry = useCallback(
    (input: NewEntryInput): MarketEntry | null => {
      const created = createMarketEntry({
        ...input,
        authorPeerId: peerId,
      });
      if (!created) return null;

      const verified = attachChecksum(created);

      setEntries((prev) => {
        if (prev.some((item) => item.id === verified.id)) return prev;
        return [verified, ...prev].sort((a, b) => b.createdAt - a.createdAt);
      });

      const msg: P2PSyncMessage = {
        type: 'NEW_ENTRY',
        entry: verified,
        senderPeerId: peerId,
        sentAt: Date.now(),
      };

      channelRef.current?.postMessage(msg);
      p2pRef.current?.broadcastNewEntry(verified);

      return verified;
    },
    [peerId]
  );

  const deleteEntry = useCallback(
    (id: string) => {
      setEntries((prev) => prev.filter((item) => item.id !== id));

      const msg: P2PSyncMessage = {
        type: 'DELETE_ENTRY',
        deletedId: id,
        senderPeerId: peerId,
        sentAt: Date.now(),
      };

      channelRef.current?.postMessage(msg);
      p2pRef.current?.broadcastDeleteEntry(id);
    },
    [peerId]
  );

  const importJsonBundle = useCallback(
    (rawJson: string) => {
      try {
        const parsed = JSON.parse(rawJson) as unknown;
        const candidateList = Array.isArray(parsed)
          ? parsed
          : parsed && typeof parsed === 'object' && Array.isArray((parsed as { entries?: unknown }).entries)
            ? (parsed as { entries: unknown[] }).entries
            : null;

        if (!candidateList) {
          return {
            ok: false,
            message: 'صيغة JSON غير صحيحة؛ يجب أن تكون مصفوفة بلاغات أو كائناً يحتوي على entries.',
            addedCount: 0,
            rejectedCount: 0,
          };
        }

        let summary = { addedCount: 0, rejectedCount: 0 };

        setEntries((prev) => {
          const mergedRes = mergeVerifiedEntries(prev, candidateList);
          summary = {
            addedCount: mergedRes.addedCount,
            rejectedCount: mergedRes.rejectedCount,
          };
          if (mergedRes.addedCount > 0) {
            const msg: P2PSyncMessage = {
              type: 'FULL_STATE',
              entries: mergedRes.merged,
              senderPeerId: peerId,
              sentAt: Date.now(),
            };
            channelRef.current?.postMessage(msg);
            p2pRef.current?.broadcastFullState(mergedRes.merged);
          }
          return mergedRes.merged;
        });

        return {
          ok: true,
          message: `تم استيراد ${summary.addedCount} عنصر جديد واستبعاد ${summary.rejectedCount} عنصر غير صالح.`,
          addedCount: summary.addedCount,
          rejectedCount: summary.rejectedCount,
        };
      } catch {
        return {
          ok: false,
          message: 'تعذر قراءة ملف أو نص JSON. تأكد من سلامة التنسيق.',
          addedCount: 0,
          rejectedCount: 0,
        };
      }
    },
    [peerId]
  );

  const exportJsonBundle = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      peerId,
      focusedZone: activeZone,
      count: filteredEntries.length,
      entries: filteredEntries.map((e) => attachChecksum(e)),
    };
    return JSON.stringify(payload, null, 2);
  }, [peerId, activeZone, filteredEntries]);

  const resetDemoData = useCallback(() => {
    const fresh = loadInitialEntries();
    setEntries(fresh);
    saveEntriesToStorage(fresh);
  }, []);

  const priceSummaries = useMemo(
    () => buildPriceSummaries(filteredEntries),
    [filteredEntries]
  );

  const barterMatches = useMemo(
    () => buildBarterMatches(filteredEntries),
    [filteredEntries]
  );

  const value: MarketContextValue = {
    entries: filteredEntries,
    allEntries: entries,
    priceSummaries,
    barterMatches,
    nodeStatus,
    focusMode,
    focusedZone,
    detectedZone: geoInference.detectedZone,
    detectedCount: geoInference.detectedCount,
    shouldSuggestLock: geoInference.shouldSuggestLock,
    activeZone,
    zoneStats: geoInference.stats,
    setFocusedZone,
    setFocusMode,
    lockToDetectedZone,
    clearGeoFocus,
    addEntry,
    deleteEntry,
    importJsonBundle,
    exportJsonBundle,
    resetDemoData,
  };

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

export function useMarket(): MarketContextValue {
  const ctx = useContext(MarketContext);
  if (!ctx) {
    throw new Error('useMarket must be used inside MarketProvider');
  }
  return ctx;
}
