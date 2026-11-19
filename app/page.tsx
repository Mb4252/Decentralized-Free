'use client';

import React, { useMemo, useState } from 'react';
import { GeoFocusBanner } from '@/components/GeoFocusBanner';
import { CommunityRadarSection } from '@/components/CommunityRadarSection';
import { useApp } from '@/lib/context';

function formatPublishedAt(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return 'غير محدد';
  const date = new Date(timestamp);
  return date.toLocaleString('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <div className="text-xs text-slate-400">البلاغات المعروضة</div>
          <div className="mt-1 text-xl font-bold">{visibleEntries.length}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <div className="text-xs text-slate-400">عروض أقل سعر</div>
          <div className="mt-1 text-xl font-bold text-emerald-300">
            {lowestPriceDeals.filter((d) => !d.isExcludedByCommunity).length}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <div className="text-xs text-slate-400">مطابقات المقايضة</div>
          <div className="mt-1 text-xl font-bold">{barterMatches.length}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <div className="text-xs text-slate-400">الأقران المتصلون</div>
          <div className="mt-1 text-xl font-bold">{nodeStatus.connectedPeers}</div>
        </div>
      </div>

      <CommunityRadarSection />

      <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">
            أحدث البلاغات والعروض {activeZone ? `في (${activeZone})` : '(كل المناطق)'}
          </h2>
          {actionMsg && (
            <span className="rounded bg-rose-500/15 px-2.5 py-0.5 text-xs text-rose-200">
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
                      : 'border border-slate-700 bg-slate-800/80 text-slate-300 hover:bg-slate-800'
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
              return (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                >
                  <div>
                    <span className="font-semibold text-white">{entry.item}</span>
                    <span className="mr-2 text-xs text-emerald-300">[{entry.location}]</span>
                    {entry.placeName && (
                      <span className="mr-2 text-xs text-slate-400">({entry.placeName})</span>
                    )}
                    {entry.category && (
                      <span className="mr-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                        {entry.category}
                      </span>
                    )}
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      نُشر: {formatPublishedAt(entry.createdAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-300">
                    <span>
                      {entry.kind === 'price' && typeof entry.price === 'number'
                        ? `${entry.price}`
                        : entry.wantItem || entry.kind}
                    </span>
                    {owned && (
                      <button
                        type="button"
                        onClick={() => handleDelete(entry.id, entry.item)}
                        className="rounded border border-rose-500/40 bg-rose-950/40 px-2 py-0.5 text-[11px] text-rose-200 hover:bg-rose-900/50"
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
