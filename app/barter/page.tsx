'use client';

import React, { useMemo } from 'react';
import { GeoFocusBanner } from '@/components/GeoFocusBanner';
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

function cleanZone(raw?: string | null): string {
  if (!raw) return '';
  const parts = raw.trim().split(' - ');
  if (parts.length > 1) {
    const last = parts[parts.length - 1].trim();
    if (/^(الجميع|شخصي|عام|خاص)\b/i.test(last)) {
      return parts.slice(0, -1).join(' - ').trim();
    }
  }
  return raw.trim();
}

export default function BarterPage() {
  const { entries, barterMatches, activeZone, canDeleteEntry, deleteEntry } = useApp();

  const barterList = useMemo(() => {
    const cleanAct = cleanZone(activeZone).toLowerCase();
    return entries.filter((e) => {
      if (e.kind !== 'have' && e.kind !== 'need') return false;
      if (!cleanAct) return true;
      return cleanZone(e.location).toLowerCase().includes(cleanAct);
    });
  }, [entries, activeZone]);

  return (
    <main dir="rtl" className="mx-auto max-w-4xl space-y-4 p-4 text-slate-100">
      <GeoFocusBanner />

      <section className="space-y-2.5 rounded-xl border border-slate-700 bg-slate-900 p-4">
        <h1 className="text-base font-bold text-emerald-300">
          المطابقات المقترحة ({barterMatches.length})
        </h1>
        {barterMatches.length === 0 ? (
          <p className="text-xs text-slate-400">
            لا توجد مطابقات متاحة في النطاق الحالي حالياً.
          </p>
        ) : (
          <ul className="space-y-2 text-xs">
            {barterMatches.map((m, idx) => (
              <li
                key={m.id || idx}
                className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-slate-100"
              >
                <div className="font-bold text-white">
                  {m.giveEntry?.item} ↔ {m.wantEntry?.item}
                </div>
                <div className="mt-1 text-slate-400">
                  {m.reason || 'مطابقة مقترحة'} — نسبة التوافق: {m.score}%
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-4">
        <h2 className="text-base font-bold text-white">
          عروض وطلبات المقايضة ({barterList.length})
        </h2>

        {barterList.length === 0 ? (
          <p className="text-xs text-slate-400">لا توجد عروض أو طلبات في هذا النطاق.</p>
        ) : (
          <ul className="space-y-2.5">
            {barterList.map((entry) => {
              const owned = canDeleteEntry(entry);
              const isHave = entry.kind === 'have';
              const zoneText = cleanZone(entry.location);
              const detailText =
                typeof entry.price === 'number'
                  ? `القيمة/السعر: ${entry.price}`
                  : entry.wantItem
                    ? `المقابل المطلوب: ${entry.wantItem}`
                    : '';

              return (
                <li
                  key={entry.id}
                  className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950 p-3.5 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-white">{entry.item}</span>
                      {zoneText && <span className="text-emerald-300">— 📍 {zoneText}</span>}
                    </div>

                    <span
                      className={`rounded-md border px-2.5 py-0.5 text-[11px] font-bold ${
                        isHave
                          ? 'border-emerald-500/40 bg-emerald-950 text-emerald-300'
                          : 'border-sky-500/40 bg-sky-950 text-sky-300'
                      }`}
                    >
                      {isHave ? 'متوفر (عرض)' : 'مطلوب (طلب)'}
                    </span>
                  </div>

                  {detailText && (
                    <div className="font-semibold text-slate-200">{detailText}</div>
                  )}

                  <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-slate-400">
                    <span>نُشر: {formatPublishedAt(entry.createdAt)}</span>
                    {owned && (
                      <button
                        type="button"
                        onClick={() => deleteEntry(entry.id)}
                        className="rounded-lg border border-rose-500/50 bg-rose-950/60 px-3 py-1 text-xs font-medium text-rose-200 hover:bg-rose-900/70"
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
