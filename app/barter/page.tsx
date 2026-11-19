'use client';

import React, { useState } from 'react';
import { GeoFocusBanner } from '@/components/GeoFocusBanner';
import { useApp } from '@/lib/context';

export default function BarterPage() {
  const { entries, barterMatches, activeZone, canDeleteEntry, deleteEntry } = useApp();
  const [deletedNote, setDeletedNote] = useState<string>('');
  const barterEntries = entries.filter((e) => e.kind === 'have' || e.kind === 'need');

  const handleDelete = (id: string, item: string) => {
    deleteEntry(id);
    setDeletedNote(`تم حذف عرض «${item}».`);
    setTimeout(() => setDeletedNote(''), 3000);
  };

  return (
    <main dir="rtl" className="mx-auto max-w-4xl space-y-4 p-4 text-slate-100">
      <GeoFocusBanner />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold text-white">
          المقايضة والمطابقات {activeZone ? `— ${activeZone}` : '— جميع المناطق'}
        </h1>
        {deletedNote && (
          <span className="rounded bg-rose-500/15 px-2.5 py-0.5 text-xs text-rose-200">
            {deletedNote}
          </span>
        )}
      </div>

      <section className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/80 p-4">
        <h2 className="text-base font-bold text-emerald-300">
          المطابقات المقترحة ({barterMatches.length})
        </h2>
        {barterMatches.length === 0 ? (
          <p className="text-xs text-slate-400">لا توجد مطابقات متاحة في النطاق الحالي.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {barterMatches.map((m, idx) => (
              <li
                key={`${m.offer.id}-${m.request.id}-${idx}`}
                className="rounded-lg border border-slate-800 bg-slate-950/75 p-3"
              >
                <div className="font-semibold text-white">
                  عرض: {m.offer.item} ({m.offer.location}) ⇄ طلب: {m.request.item} (
                  {m.request.location})
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  درجة التطابق: {m.score}% — {m.reason}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/80 p-4">
        <h2 className="text-base font-bold text-white">
          عروض وطلبات المقايضة ({barterEntries.length})
        </h2>
        {barterEntries.length === 0 ? (
          <p className="text-xs text-slate-400">لا توجد عروض مقايضة في هذا النطاق بعد.</p>
        ) : (
          <ul className="divide-y divide-slate-800 text-sm">
            {barterEntries.map((item) => {
              const owned = canDeleteEntry(item);
              return (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                >
                  <div>
                    <span className="font-semibold text-white">{item.item}</span>
                    <span className="mr-2 text-xs text-emerald-300">— {item.location}</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-300">
                      {item.kind === 'have' ? 'متوفر' : 'مطلوب'}
                      {item.wantItem ? ` (يطلب: ${item.wantItem})` : ''}
                    </span>
                    {owned && (
                      <button
                        type="button"
                        onClick={() => handleDelete(item.id, item.item)}
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
        )}
      </section>
    </main>
  );
}
