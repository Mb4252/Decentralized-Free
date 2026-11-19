'use client';

import React, { useState } from 'react';
import { GeoFocusBanner } from '@/components/GeoFocusBanner';
import { useApp } from '@/lib/context';
import { MarketEntry } from '@/core/market-engine';

function formatPublishedAt(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return 'غير محدد';
  return new Date(timestamp).toLocaleString('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function computeMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100;
  }
  return sorted[mid];
}

interface ReportLike {
  id?: string;
  entry?: MarketEntry;
  price?: number;
  placeName?: string;
  location?: string;
  createdAt?: number;
  label?: string;
  item?: string;
}

export default function PricesPage() {
  const { entries, priceSummaries, activeZone, canDeleteEntry, deleteEntry } = useApp();
  const [deletedNote, setDeletedNote] = useState<string>('');

  const handleDelete = (id: string, item: string) => {
    deleteEntry(id);
    setDeletedNote(`تم حذف بلاغ «${item}».`);
    setTimeout(() => setDeletedNote(''), 3000);
  };

  const resolveMatchingEntry = (rep: ReportLike, itemFallback: string): MarketEntry | null => {
    if (rep.entry) return rep.entry;
    if (rep.id) {
      const byId = entries.find((e) => e.id === rep.id);
      if (byId) return byId;
    }
    const targetItem = (rep.item || itemFallback || '').trim();
    const targetLoc = (rep.location || '').trim();
    const byMatch = entries.find(
      (e) =>
        e.kind === 'price' &&
        e.item.trim() === targetItem &&
        (!targetLoc || e.location.trim() === targetLoc) &&
        (typeof rep.price !== 'number' || e.price === rep.price)
    );
    return byMatch || null;
  };

  return (
    <main dir="rtl" className="mx-auto max-w-4xl space-y-4 p-4 text-slate-100">
      <GeoFocusBanner />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-white">
          مؤشر الأسعار {activeZone ? `— ${activeZone}` : '— جميع المناطق'}
        </h1>
        {deletedNote && (
          <span className="rounded bg-rose-500/15 px-2.5 py-0.5 text-xs text-rose-200">
            {deletedNote}
          </span>
        )}
      </div>

      {priceSummaries.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/75 p-4 text-sm text-slate-300">
          لا توجد بلاغات أسعار في هذا النطاق بعد. أضف أسعار اليوم يدوياً من زر «إضافة».
        </div>
      ) : (
        <div className="space-y-3">
          {priceSummaries.map((summary, summaryIdx) => {
            const rawReports = (summary.reports || []) as unknown as ReportLike[];
            const prices: number[] = [];

            for (let i = 0; i < rawReports.length; i++) {
              const r = rawReports[i];
              const p =
                typeof r.entry?.price === 'number'
                  ? r.entry.price
                  : typeof r.price === 'number'
                    ? r.price
                    : null;
              if (typeof p === 'number' && Number.isFinite(p)) {
                prices.push(p);
              }
            }

            const minPrice = prices.length > 0 ? Math.min.apply(null, prices) : null;
            const maxPrice = prices.length > 0 ? Math.max.apply(null, prices) : null;
            const medianPrice = computeMedian(prices);

            return (
              <div
                key={summary.item || `summary-${summaryIdx}`}
                className="rounded-xl border border-slate-800 bg-slate-900/80 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-bold text-emerald-300">{summary.item}</h2>
                  <span className="text-xs text-slate-400">
                    عدد البلاغات: {rawReports.length}
                  </span>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-slate-950/70 p-2">
                    <div className="text-slate-400">أقل سعر</div>
                    <div className="mt-0.5 font-bold text-emerald-300">
                      {minPrice !== null ? minPrice : '-'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-950/70 p-2">
                    <div className="text-slate-400">الوسيط العادل</div>
                    <div className="mt-0.5 font-bold text-white">
                      {medianPrice !== null ? medianPrice : '-'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-950/70 p-2">
                    <div className="text-slate-400">أعلى سعر</div>
                    <div className="mt-0.5 font-bold text-amber-300">
                      {maxPrice !== null ? maxPrice : '-'}
                    </div>
                  </div>
                </div>

                <ul className="mt-3 divide-y divide-slate-800/80 text-xs">
                  {rawReports.map((rep, repIdx) => {
                    const matchedEntry = resolveMatchingEntry(rep, summary.item || '');
                    const rowId = matchedEntry?.id || rep.id || `rep-${summaryIdx}-${repIdx}`;
                    const displayPrice =
                      typeof matchedEntry?.price === 'number'
                        ? matchedEntry.price
                        : typeof rep.price === 'number'
                          ? rep.price
                          : '-';
                    const placeName = matchedEntry?.placeName || rep.placeName;
                    const location = matchedEntry?.location || rep.location;
                    const createdAt = matchedEntry?.createdAt ?? rep.createdAt;
                    const owned = matchedEntry ? canDeleteEntry(matchedEntry) : false;

                    return (
                      <li
                        key={rowId}
                        className="flex flex-wrap items-center justify-between gap-2 py-2"
                      >
                        <div>
                          <span className="font-semibold text-white">{displayPrice}</span>
                          {placeName && (
                            <span className="mr-2 text-slate-300">({placeName})</span>
                          )}
                          {location && (
                            <span className="mr-2 text-emerald-300">[{location}]</span>
                          )}
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            نُشر: {formatPublishedAt(createdAt)}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {rep.label && <span className="text-slate-400">{rep.label}</span>}
                          {owned && matchedEntry && (
                            <button
                              type="button"
                              onClick={() => handleDelete(matchedEntry.id, matchedEntry.item)}
                              className="rounded border border-rose-500/40 bg-rose-950/50 px-2 py-0.5 text-[11px] text-rose-200 hover:bg-rose-900/60"
                            >
                              حذف
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
