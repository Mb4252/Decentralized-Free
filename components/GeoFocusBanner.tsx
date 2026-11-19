'use client';

import React from 'react';
import { useApp } from '@/lib/context';

export function GeoFocusBanner() {
  const {
    focusMode,
    detectedZone,
    detectedCount,
    shouldSuggestLock,
    activeZone,
    zoneStats,
    setFocusedZone,
    lockToDetectedZone,
    clearGeoFocus,
  } = useApp();

  if (!detectedZone && zoneStats.length === 0 && !activeZone) {
    return null;
  }

  const isLocked = focusMode === 'locked' && Boolean(activeZone);

  return (
    <section
      dir="rtl"
      aria-label="التركيز الجغرافي المحلي"
      className="mb-4 rounded-xl border border-emerald-500/30 bg-slate-900/80 p-3.5 text-sm text-slate-100 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-block rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">
              {isLocked ? `محصور على: ${activeZone}` : 'الوضع العام (جميع المناطق)'}
            </span>

            {detectedZone && (
              <span className="text-xs text-slate-300">
                الحي/المنطقة الأكثر تكراراً لديك:{' '}
                <strong className="text-white">{detectedZone}</strong> ({detectedCount} مرة)
              </span>
            )}
          </div>

          {!isLocked && shouldSuggestLock && detectedZone && (
            <p className="text-xs text-amber-300/90">
              تم رصد تكرار نشاطك في «{detectedZone}» — يمكنك حصر العرض والأسعار والمقايضة عليه لتقليل الضجيج.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {zoneStats.length > 0 && (
            <select
              aria-label="اختيار منطقة أو حي للحصر"
              value={isLocked ? activeZone || '' : ''}
              onChange={(e) => {
                const val = e.target.value;
                setFocusedZone(val ? val : null);
              }}
              className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-100 focus:border-emerald-400 focus:outline-none"
            >
              <option value="">كل المناطق والأحياء</option>
              {zoneStats.map((item) => (
                <option key={item.normalizedKey} value={item.zone}>
                  {item.zone} ({item.count})
                </option>
              ))}
            </select>
          )}

          {!isLocked && detectedZone && (
            <button
              type="button"
              onClick={lockToDetectedZone}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-500"
            >
              حصر على «{detectedZone}»
            </button>
          )}

          {isLocked && (
            <button
              type="button"
              onClick={clearGeoFocus}
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
            >
              عرض الكل
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
