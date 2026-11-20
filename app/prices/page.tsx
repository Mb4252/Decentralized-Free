'use client';

import React, { useState } from 'react';
import { GeoFocusBanner } from '@/components/GeoFocusBanner';
import { useApp } from '@/lib/context';
import type { MarketEntry } from '@/core/types';

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

function cleanZoneTitle(zone?: string | null): string {
  if (!zone) return '';
  const parts = zone.split(' - ');
  return (parts[0] || zone).trim();
}

function extractPhone(text?: string): string | null {
  if (!text) return null;
  const match = text.match(/(\+?\d[\d\s\-]{6,15}\d)/);
  return match ? match[1].replace(/\s+/g, '') : null;
}

function getEntryNote(entry: unknown): string {
  if (!entry || typeof entry !== 'object') return '';
  const rec = entry as Record<string, unknown>;
  const raw = rec.note ?? rec.notes ?? rec.description ?? '';
  return typeof raw === 'string' ? raw.trim() : '';
}

function getEntryPhone(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null;
  const rec = entry as Record<string, unknown>;
  const direct = rec.phone ?? rec.contact ?? rec.whatsapp ?? rec.mobile ?? '';
  if (typeof direct === 'string' && direct.trim()) {
    return extractPhone(direct) || direct.trim();
  }
  return extractPhone(getEntryNote(entry));
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
  const displayZone = cleanZoneTitle(activeZone);

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
    return (
      entries.find(
        (e) =>
          e.kind === 'price' &&
          e.item.trim() === targetItem &&
          (!targetLoc || e.location.trim() === targetLoc) &&
          (typeof rep.price !== 'number' || e.price === rep.price)
      ) || null
    );
  };

  return (
    <main dir="rtl" className="mx-auto max-w-4xl space-y-4 p-4 text-slate-100">
      <GeoFocusBanner />

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3">
        <h1 className="text-lg font-bold text-white">
          مؤشر الأسعار {displayZone ? `— ${displayZone}` : '— جميع المناطق'}
        </h1>
        {deletedNote && (
          <span className="rounded bg-rose-950 border border-rose-500/40 px-2.5 py-0.5 text-xs text-rose-200">
            {deletedNote}
          </span>
        )}
      </div>

      {priceSummaries.length === 0 ? (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm text-slate-300">
          لا توجد بلاغات أسعار في هذا النطاق بعد. أضف أسعار اليوم يدوياً من زر «إضافة».
        </div>
      ) : (
        <div className="space-y-3">
          {priceSummaries.map((summary, summaryIdx) => {
            const rawReports = (summary.reports || []) as unknown as ReportLike[];
            const prices: number[] = [];
            for (const r of rawReports) {
              const p =
                typeof r.entry?.price === 'number'
                  ? r.entry.price
                  : typeof r.price === 'number'
                    ? r.price
                    : null;
              if (typeof p === 'number' && Number.isFinite(p)) prices.push(p);
            }
            const minPrice = prices.length > 0 ? Math.min(...prices) : null;
            const maxPrice = prices.length > 0 ? Math.max(...prices) : null;

            return (
              <div
                key={summary.item || `summary-${summaryIdx}`}
                className="rounded-xl border border-slate-700 bg-slate-900 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-bold text-emerald-300">{summary.item}</h2>
                  <span className="text-xs text-slate-400">عدد البلاغات: {rawReports.length}</span>
                </div>

                <div className="mt-2.5 grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-2">
                    <div className="text-slate-400">أقل سعر</div>
                    <div className="mt-0.5 font-bold text-emerald-300">
                      {minPrice !== null ? minPrice : '-'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-2">
                    <div className="text-slate-400">P25 (ربع أدنى)</div>
                    <div className="mt-0.5 font-bold text-sky-300">
                      {summary.p25 !== null ? summary.p25 : '-'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-2">
                    <div className="text-slate-400">الوسيط العادل</div>
                    <div className="mt-0.5 font-bold text-white">
                      {summary.median !== null ? summary.median : '-'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-2">
                    <div className="text-slate-400">P75 (ربع أعلى)</div>
                    <div className="mt-0.5 font-bold text-amber-300">
                      {summary.p75 !== null ? summary.p75 : '-'}
                    </div>
                  </div>
                </div>

                <ul className="mt-3 divide-y divide-slate-800 text-xs">
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
                    const location = cleanZoneTitle(matchedEntry?.location || rep.location);
                    const createdAt = matchedEntry?.createdAt ?? rep.createdAt;
                    const note = matchedEntry ? getEntryNote(matchedEntry) : '';
                    const phone = matchedEntry ? getEntryPhone(matchedEntry) : null;
                    const owned = matchedEntry ? canDeleteEntry(matchedEntry) : false;

                    return (
                      <li
                        key={rowId}
                        className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="space-y-1">
                          <div>
                            <span className="font-bold text-white">{displayPrice}</span>
                            {placeName && <span className="mr-2 text-amber-300">({placeName})</span>}
                            {location && <span className="mr-2 text-emerald-300">[{location}]</span>}
                          </div>

                          {note && (
                            <div className="rounded bg-slate-950 px-2 py-1 text-[11px] text-slate-200">
                              📝 {note}
                            </div>
                          )}

                          {phone && (
                            <div className="flex flex-wrap gap-2 pt-0.5">
                              <a
                                href={`tel:${phone}`}
                                className="rounded bg-sky-700 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-sky-600"
                              >
                                📞 {phone}
                              </a>
                              <a
                                href={`https://wa.me/${phone.replace(/[^\d]/g, '')}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded bg-emerald-700 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-600"
                              >
                                💬 واتساب
                              </a>
                            </div>
                          )}

                          <div className="text-[11px] text-slate-400">
                            نُشر: {formatPublishedAt(createdAt)}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {rep.label && <span className="text-slate-400">{rep.label}</span>}
                          {owned && matchedEntry && (
                            <button
                              type="button"
                              onClick={() => handleDelete(matchedEntry.id, matchedEntry.item)}
                              className="rounded border border-rose-500/50 bg-rose-950/60 px-2.5 py-1 text-[11px] text-rose-200 hover:bg-rose-900/70"
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
