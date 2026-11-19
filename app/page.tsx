'use client';

import React from 'react';
import { GeoFocusBanner } from '@/components/GeoFocusBanner';
import { useMarket } from '@/lib/context';

export default function HomePage() {
  const { entries, priceSummaries, barterMatches, nodeStatus, activeZone } = useMarket();

  return (
    <main dir="rtl" className="mx-auto max-w-4xl space-y-4 p-4 text-slate-100">
      <GeoFocusBanner />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <div className="text-xs text-slate-400">البلاغات المعروضة</div>
          <div className="mt-1 text-xl font-bold">{entries.length}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
          <div className="text-xs text-slate-400">ملخصات الأسعار</div>
          <div className="mt-1 text-xl font-bold">{priceSummaries.length}</div>
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

      <section className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-base font-semibold">
          أحدث البلاغات والعروض {activeZone ? `في (${activeZone})` : '(كل المناطق)'}
        </h2>
        {entries.length === 0 ? (
          <p className="text-sm text-slate-400">
            لا توجد عناصر مطابقة للنطاق الحالي. يمكنك التبديل إلى «عرض الكل» أو إضافة بلاغ جديد.
          </p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div>
                  <span className="font-semibold text-white">{entry.item}</span>
                  <span className="mr-2 text-xs text-emerald-300">[{entry.location}]</span>
                  {entry.placeName && (
                    <span className="mr-2 text-xs text-slate-400">({entry.placeName})</span>
                  )}
                </div>
                <div className="text-xs text-slate-300">
                  {typeof entry.price === 'number' ? `${entry.price}` : entry.wantItem || entry.kind}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
