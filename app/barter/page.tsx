'use client';

import React from 'react';
import { GeoFocusBanner } from '@/components/GeoFocusBanner';
import { useApp } from '@/lib/context';

export default function BarterPage() {
  const { barterMatches, entries, activeZone } = useApp();
  const barterEntries = entries.filter((e) => e.kind === 'have' || e.kind === 'need');

  return (
    <main dir="rtl" className="mx-auto max-w-4xl space-y-4 p-4 text-slate-100">
      <GeoFocusBanner />

      <h1 className="text-lg font-bold">
        المقايضة والمطابقات {activeZone ? `— ${activeZone}` : '— جميع المناطق'}
      </h1>

      <section className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-sm font-semibold text-emerald-300">
          المطابقات المقترحة ({barterMatches.length})
        </h2>
        {barterMatches.length === 0 ? (
          <p className="text-xs text-slate-400">لا توجد مطابقات متاحة في النطاق الحالي.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {barterMatches.map((match) => (
              <li
                key={match.id}
                className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 text-xs"
              >
                {match.summary}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-sm font-semibold text-white">
          عروض وطلبات المقايضة ({barterEntries.length})
        </h2>
        {barterEntries.length === 0 ? (
          <p className="text-xs text-slate-400">لا توجد عروض أو طلبات مقايضة في هذا النطاق.</p>
        ) : (
          <ul className="divide-y divide-slate-800 text-sm">
            {barterEntries.map((item) => (
              <li key={item.id} className="flex items-center justify-between py-2">
                <span>
                  <strong className="text-white">{item.item}</strong> —{' '}
                  <span className="text-xs text-slate-400">{item.location}</span>
                </span>
                <span className="text-xs text-emerald-300">
                  {item.kind === 'have'
                    ? `متوفر (يطلب: ${item.wantItem || 'أي بديل'})`
                    : 'مطلوب'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
