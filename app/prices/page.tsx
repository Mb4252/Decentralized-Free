'use client';

import React from 'react';
import { GeoFocusBanner } from '@/components/GeoFocusBanner';
import { useApp } from '@/lib/context';

export default function PricesPage() {
  const { priceSummaries, activeZone } = useApp();

  return (
    <main dir="rtl" className="mx-auto max-w-4xl space-y-4 p-4 text-slate-100">
      <GeoFocusBanner />

      <h1 className="text-lg font-bold">
        مؤشر الأسعار {activeZone ? `— ${activeZone}` : '— جميع المناطق'}
      </h1>

      {priceSummaries.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-400">
          لا توجد بيانات أسعار متاحة ضمن النطاق المحدد حالياً.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {priceSummaries.map((summary) => (
            <div
              key={`${summary.category}-${summary.item}`}
              className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-sm"
            >
              <div className="font-semibold text-white">{summary.item}</div>
              <div className="mt-1 text-xs text-slate-400">الفئة: {summary.category}</div>
              <div className="mt-2 flex items-center justify-between text-xs text-emerald-300">
                <span>الوسيط: {summary.median ?? '-'}</span>
                <span>عدد البلاغات: {summary.reports.length}</span>
              </div>
              {summary.cheapestPlace && (
                <div className="mt-1 text-xs text-slate-400">
                  الأقل: {summary.lowestPrice} ({summary.cheapestPlace})
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
