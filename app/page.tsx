'use client';

import React, { useMemo, useState } from 'react';
import { GeoFocusBanner } from '@/components/GeoFocusBanner';
import { CommunityRadarSection } from '@/components/CommunityRadarSection';
import { useApp } from '@/lib/context';

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
  const noteText = getEntryNote(entry);
  return extractPhone(noteText);
}

export default function HomePage() {
  const {
    entries,
    priceSummaries,
    barterMatches,
    lowestPriceDeals,
    nodeStatus,
    activeZone,
    canDeleteEntry,
    deleteEntry,
  } = useApp();

  const [selectedCategory, setSelectedCategory] = useState<string>('الكل');
  const [actionMsg, setActionMsg] = useState<string>('');

  const displayZone = cleanZoneTitle(activeZone);

  const categories = useMemo(() => {
    const list: string[] = ['الكل'];
    for (let i = 0; i < entries.length; i++) {
      const cat = (entries[i].category || '').trim();
      if (cat && list.indexOf(cat) === -1) {
        list.push(cat);
      }
    }
    return list;
  }, [entries]);

  const visibleEntries = useMemo(() => {
    if (selectedCategory === 'الكل') return entries;
    return entries.filter((e) => (e.category || '').trim() === selectedCategory);
  }, [entries, selectedCategory]);

  const handleDelete = (id: string, itemName: string) => {
    deleteEntry(id);
    setActionMsg(`تم حذف منشور «${itemName}».`);
    setTimeout(() => setActionMsg(''), 3000);
  };

  return (
    <main dir="rtl" className="mx-auto max-w-4xl space-y-4 p-4 text-slate-100">
      <GeoFocusBanner />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
          <div className="text-xs text-slate-400">البلاغات المعروضة</div>
          <div className="mt-1 text-xl font-bold text-white">{visibleEntries.length}</div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
          <div className="text-xs text-slate-400">عروض أقل سعر</div>
          <div className="mt-1 text-xl font-bold text-emerald-300">
            {lowestPriceDeals.filter((d) => !d.isExcludedByCommunity).length}
          </div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
          <div className="text-xs text-slate-400">مطابقات المقايضة</div>
          <div className="mt-1 text-xl font-bold text-white">{barterMatches.length}</div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
          <div className="text-xs text-slate-400">الأقران المتصلون</div>
          <div className="mt-1 text-xl font-bold text-white">{nodeStatus.connectedPeers}</div>
        </div>
      </div>

      <CommunityRadarSection />

      <section className="space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-white">
            أحدث البلاغات والعروض {displayZone ? `في (${displayZone})` : '(كل المناطق)'}
          </h2>
          {actionMsg && (
            <span className="rounded bg-rose-950 border border-rose-500/40 px-2.5 py-0.5 text-xs text-rose-200">
              {actionMsg}
            </span>
          )}
        </div>

        {categories.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {categories.map((cat) => {
              const active = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    active
                      ? 'bg-emerald-600 text-white'
                      : 'border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        )}

        {visibleEntries.length === 0 ? (
          <p className="text-sm text-slate-400">
            لا توجد عناصر مطابقة للنطاق أو الفئة الحالية. يمكنك التبديل إلى «عرض الكل» أو إضافة بلاغ جديد.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {visibleEntries.map((entry) => {
              const owned = canDeleteEntry(entry);
              const note = getEntryNote(entry);
              const phone = getEntryPhone(entry);

              return (
                <li
                  key={entry.id}
                  className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-white">{entry.item}</span>
                      <span className="text-xs text-emerald-300">
                        [{cleanZoneTitle(entry.location)}]
                      </span>
                      {entry.placeName && (
                        <span className="text-xs text-amber-300">• {entry.placeName}</span>
                      )}
                      {entry.category && (
                        <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-200">
                          {entry.category}
                        </span>
                      )}
                    </div>

                    {note && (
                      <div className="rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200">
                        📝 ملاحظة: {note}
                      </div>
                    )}

                    {phone && (
                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        <a
                          href={`tel:${phone}`}
                          className="rounded bg-sky-700 px-2.5 py-0.5 text-[11px] font-medium text-white hover:bg-sky-600"
                        >
                          📞 اتصال: {phone}
                        </a>
                        <a
                          href={`https://wa.me/${phone.replace(/[^\d]/g, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded bg-emerald-700 px-2.5 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-600"
                        >
                          💬 واتساب
                        </a>
                      </div>
                    )}

                    <div className="text-[11px] text-slate-400">
                      نُشر: {formatPublishedAt(entry.createdAt)}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <span className="rounded bg-slate-800 px-2.5 py-1 text-xs font-bold text-emerald-300">
                      {entry.kind === 'price' && typeof entry.price === 'number'
                        ? `${entry.price}`
                        : entry.wantItem || entry.kind}
                    </span>
                    {owned && (
                      <button
                        type="button"
                        onClick={() => handleDelete(entry.id, entry.item)}
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
        )}
      </section>

      <div className="text-xs text-slate-400">
        عدد السلع المحللة في مؤشر الأسعار: {priceSummaries.length}
      </div>
    </main>
  );
}
