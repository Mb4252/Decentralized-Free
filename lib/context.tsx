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
import type { MarketEntry, RankedMatch, ReportKind } from '@/core/types';
import {
  DEFAULT_SAMPLE_ITEMS,
  ItemPriceSummary,
  analyzeItemPrices,
  getOrCreateLocalPeer,
  normalizeText,
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
import {
  DiscoveredPlaceSummary,
  LowestPriceDeal,
  buildPlaceKey,
  discoverLowestPrices,
  discoverZonePlaces,
} from '@/core/market-intelligence';
import type { PlaceFeedbackReport, PlaceFeedbackVerdict } from '@/core/types';
import { findRankedMatches } from '@/core/barter';

const ENTRIES_STORAGE_KEY = 'market_radar_entries_v1';
const GEO_FOCUS_STORAGE_KEY = 'market_radar_geo_focus_v1';
const PLACE_FEEDBACK_STORAGE_KEY = 'market_radar_place_feedback_v1';

export interface NewEntryInput {
  kind: ReportKind;
  category: string;
  item: string;
  placeName?: string;
  quantity?: string;
  wantItem?: string;
  location: string;
  price?: number;
  authorName?: string;
  contact?: string;
  note?: string;
}

export interface BundleImportResult {
  ok: boolean;
  message: string;
  error?: string;
  addedCount: number;
  importedCount: number;
  rejectedCount: number;
}

export interface SubmitPlaceFeedbackInput {
  placeName: string;
  location: string;
  item?: string;
  verdict: PlaceFeedbackVerdict;
  reason?: string;
}

interface AppContextValue {
  entries: MarketEntry[];
  allEntries: MarketEntry[];
  priceSummaries: ItemPriceSummary[];
  barterMatches: RankedMatch[];
  matches: RankedMatch[];
  lowestPriceDeals: LowestPriceDeal[];
  zonePlaces: DiscoveredPlaceSummary[];
  placeFeedbacks: PlaceFeedbackReport[];
  nodeStatus: NodeStatus;
  peerId: string;
  defaultName: string;
  localPeer: { peerId: string; defaultName: string };
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
  canDeleteEntry: (entry: Pick<MarketEntry, 'authorPeerId'>) => boolean;
  deleteEntry: (id: string) => void;
  submitPlaceFeedback: (input: SubmitPlaceFeedbackInput) => PlaceFeedbackReport | null;
  importJsonBundle: (rawJson: string) => BundleImportResult;
  exportJsonBundle: () => string;
  importBundleJson: (rawJson: string) => BundleImportResult;
  exportBundleJson: () => string;
  resetDemoData: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

function loadStoredEntries(): MarketEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(ENTRIES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is MarketEntry =>
        Boolean(item && typeof item === 'object' && typeof (item as MarketEntry).id === 'string')
    );
  } catch {
    return [];
  }
}

function saveStoredEntries(entries: MarketEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ENTRIES_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // تجاهل
  }
}

function loadStoredFeedbacks(): PlaceFeedbackReport[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PLACE_FEEDBACK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is PlaceFeedbackReport =>
        Boolean(
          item &&
            typeof item === 'object' &&
            typeof (item as PlaceFeedbackReport).id === 'string' &&
            typeof (item as PlaceFeedbackReport).verdict === 'string'
        )
    );
  } catch {
    return [];
  }
}

function saveStoredFeedbacks(feedbacks: PlaceFeedbackReport[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PLACE_FEEDBACK_STORAGE_KEY, JSON.stringify(feedbacks));
  } catch {
    // تجاهل
  }
}

function loadSavedGeoFocus(): { mode: GeoFocusMode; focusedZone: string | null } {
  if (typeof window === 'undefined') return { mode: 'auto', focusedZone: null };
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

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [{ peerId, defaultName }] = useState(() => getOrCreateLocalPeer());
  const [entries, setEntries] = useState<MarketEntry[]>(() => loadStoredEntries());
  const [placeFeedbacks, setPlaceFeedbacks] = useState<PlaceFeedbackReport[]>(() =>
    loadStoredFeedbacks()
  );
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
    saveStoredEntries(entries);
  }, [entries]);

  useEffect(() => {
    saveStoredFeedbacks(placeFeedbacks);
  }, [placeFeedbacks]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        GEO_FOCUS_STORAGE_KEY,
        JSON.stringify({ mode: focusMode, focusedZone })
      );
    } catch {
      // تجاهل
    }
  }, [focusMode, focusedZone]);

  const applyIncomingMessage = useCallback(
    (msg: P2PSyncMessage) => {
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
    },
    [peerId]
  );

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
        setNodeStatus((prev) => ({ ...prev, connectedPeers, mode }));
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
    if (cleaned) setFocusModeState('locked');
    else setFocusModeState('all');
  }, []);

  const setFocusMode = useCallback((mode: GeoFocusMode) => {
    setFocusModeState(mode);
    if (mode === 'all') setFocusedZoneState(null);
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
    () => filterEntriesByGeoFocus(entries, focusMode, focusedZone, geoInference.detectedZone),
    [entries, focusMode, focusedZone, geoInference.detectedZone]
  );

  const addEntry = useCallback(
    (input: NewEntryInput): MarketEntry | null => {
      const item = (input.item || '').trim();
      const location = (input.location || '').trim();
      if (!item || !location) return null;

      const created: MarketEntry = {
        id: `ent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        kind: input.kind,
        category: (input.category || 'بقالة').trim() || 'بقالة',
        item,
        placeName: input.placeName?.trim() || undefined,
        quantity: input.quantity?.trim() || undefined,
        wantItem: input.wantItem?.trim() || undefined,
        location,
        price:
          typeof input.price === 'number' && Number.isFinite(input.price)
            ? input.price
            : undefined,
        authorName: (input.authorName || defaultName).trim() || defaultName,
        authorPeerId: peerId,
        contact: input.contact?.trim() || undefined,
        note: input.note?.trim() || undefined,
        createdAt: Date.now(),
      };

      const verified = attachChecksum(created);

      setEntries((prev) => {
        if (prev.some((existing) => existing.id === verified.id)) return prev;
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
    [defaultName, peerId]
  );

  const canDeleteEntry = useCallback(
    (entry: Pick<MarketEntry, 'authorPeerId'>) =>
      Boolean(entry.authorPeerId && entry.authorPeerId === peerId),
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

  const submitPlaceFeedback = useCallback(
    (input: SubmitPlaceFeedbackInput): PlaceFeedbackReport | null => {
      const placeName = (input.placeName || '').trim();
      const location = (input.location || activeZone || '').trim();
      if (!placeName || !location) return null;

      const report: PlaceFeedbackReport = {
        id: `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        targetPlaceKey: buildPlaceKey(placeName, location),
        targetPlaceName: placeName,
        targetLocation: location,
        targetItem: input.item?.trim() || undefined,
        verdict: input.verdict,
        reason: input.reason?.trim() || undefined,
        reporterPeerId: peerId,
        reporterName: defaultName,
        createdAt: Date.now(),
      };

      setPlaceFeedbacks((prev) => {
        const withoutSamePeerSameVerdict = prev.filter(
          (item) =>
            !(
              item.reporterPeerId === peerId &&
              item.targetPlaceKey === report.targetPlaceKey &&
              item.verdict === report.verdict
            )
        );
        return [report, ...withoutSamePeerSameVerdict];
      });

      return report;
    },
    [activeZone, defaultName, peerId]
  );

  const importJsonBundle = useCallback(
    (rawJson: string): BundleImportResult => {
      try {
        const parsed = JSON.parse(rawJson) as unknown;
        const candidateList = Array.isArray(parsed)
          ? parsed
          : parsed &&
              typeof parsed === 'object' &&
              Array.isArray((parsed as { entries?: unknown }).entries)
            ? (parsed as { entries: unknown[] }).entries
            : null;

        if (!candidateList) {
          const msg = 'صيغة JSON غير صحيحة؛ يجب أن تكون مصفوفة بلاغات أو كائناً يحتوي على entries.';
          return {
            ok: false,
            message: msg,
            error: msg,
            addedCount: 0,
            importedCount: 0,
            rejectedCount: 0,
          };
        }

        const mergedRes = mergeVerifiedEntries(entriesRef.current, candidateList);
        setEntries(mergedRes.merged);

        if (mergedRes.addedCount > 0) {
          const msgPayload: P2PSyncMessage = {
            type: 'FULL_STATE',
            entries: mergedRes.merged,
            senderPeerId: peerId,
            sentAt: Date.now(),
          };
          channelRef.current?.postMessage(msgPayload);
          p2pRef.current?.broadcastFullState(mergedRes.merged);
        }

        return {
          ok: true,
          message: `تم استيراد ${mergedRes.addedCount} عنصر جديد واستبعاد ${mergedRes.rejectedCount} عنصر غير صالح.`,
          addedCount: mergedRes.addedCount,
          importedCount: mergedRes.addedCount,
          rejectedCount: mergedRes.rejectedCount,
        };
      } catch {
        const msg = 'تعذر قراءة ملف أو نص JSON. تأكد من سلامة التنسيق.';
        return {
          ok: false,
          message: msg,
          error: msg,
          addedCount: 0,
          importedCount: 0,
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
    setEntries([]);
    setPlaceFeedbacks([]);
    saveStoredEntries([]);
    saveStoredFeedbacks([]);
  }, []);

  const priceSummaries = useMemo(() => {
    const itemMap = new Map<string, string>();
    for (const sample of DEFAULT_SAMPLE_ITEMS) itemMap.set(normalizeText(sample), sample);
    for (const entry of filteredEntries) {
      if (entry.kind === 'price' && entry.item.trim()) {
        const key = normalizeText(entry.item);
        if (!itemMap.has(key)) itemMap.set(key, entry.item.trim());
      }
    }
    return Array.from(itemMap.values())
      .map((itemName) => analyzeItemPrices(filteredEntries, itemName))
      .filter((summary) => summary.reports.length > 0);
  }, [filteredEntries]);

  const barterMatches = useMemo(
    () => findRankedMatches(filteredEntries, Date.now()),
    [filteredEntries]
  );

  const lowestPriceDeals = useMemo(
    () => discoverLowestPrices(entries, placeFeedbacks, activeZone),
    [entries, placeFeedbacks, activeZone]
  );

  const zonePlaces = useMemo(
    () => discoverZonePlaces(entries, placeFeedbacks, activeZone),
    [entries, placeFeedbacks, activeZone]
  );

  const localPeer = useMemo(() => ({ peerId, defaultName }), [peerId, defaultName]);

  const value: AppContextValue = {
    entries: filteredEntries,
    allEntries: entries,
    priceSummaries,
    barterMatches,
    matches: barterMatches,
    lowestPriceDeals,
    zonePlaces,
    placeFeedbacks,
    nodeStatus,
    peerId,
    defaultName,
    localPeer,
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
    canDeleteEntry,
    deleteEntry,
    submitPlaceFeedback,
    importJsonBundle,
    exportJsonBundle,
    importBundleJson: importJsonBundle,
    exportBundleJson: exportJsonBundle,
    resetDemoData,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
