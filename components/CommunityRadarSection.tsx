'use client';

import React, { useState } from 'react';
import { useApp } from '@/lib/context';
import { PlaceFeedbackVerdict } from '@/core/market-intelligence';

export function CommunityRadarSection() {
  const { lowestPriceDeals, zonePlaces, activeZone, submitPlaceFeedback } = useApp();
  const [selectedPlaceKey, setSelectedPlaceKey] = useState<string>('');
  const [reasonText, setReasonText] = useState<string>('');

  const handleFeedback = (
    placeName: string,
    location: string,
    verdict: PlaceFeedbackVerdict
  ) => {
    submitPlaceFeedback({
      placeName,
      location,
      verdict,
      reason: reasonText,
    });
    setReasonText('');
  };

  return (
    <div className="space-y-4">
      {/* 1. أقل الأسعار والمخفضة للعامة */}
      <section className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-900/75 p-4 text-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-emerald-300">
            أقل الأسعار والعروض المخفضة {activeZone ? `في (${activeZone})` : '(كل المناطق)'}
          </h2>
          <span className="text-xs text-slate-400">
            تستخرج الخوارزمية أقل سعر مرصود وتقارنه بالوسيط السعري
          </span>
        </div>

        {lowestPriceDeals.length === 0 ? (
          <p className="text-xs text-slate-400">
            لا توجد بلاغات أسعار كافية بعد لاستخراج العروض المخفضة في هذا النطاق.
          </p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {lowestPriceDeals.slice(0, 6).map((deal) => (
              <div
                key={deal.id}
                className={`rounded-lg border p-3 text-xs ${
                  deal.isExcludedByCommunity
                    ? 'border-rose-500/40 bg-rose-950/25 text-rose-200'
                    : 'border-slate-800 bg-slate-950/65 text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-white">{deal.item}</span>
                  <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-300">
                    {deal.price}
                  </span>
                </div>

                <div className="mt-1 text-slate-400">
                  {deal.placeName ? `${deal.placeName} — ` : ''}
                  {deal.location}
                </div>

                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1 text-[11px]">
                  <span>
                    الوسيط: {deal.medianPrice ?? '-'} ({deal.reportsCountForItem} بلاغ)
                  </span>
                  {deal.discountPercent > 0 && (
                    <span className="text-emerald-300">أقل من الوسيط بـ {deal.discountPercent}%</span>
                  )}
                </div>

                {deal.isExcludedByCommunity && (
                  <div className="mt-1.5 rounded bg-rose-500/20 px-2 py-1 text-[11px] font-medium text-rose-200">
                    مستبعد مؤقتاً بناءً على بلاغات عدم المطابقة/الخداع من سكان المنطقة
                  </div>
                )}

                {!deal.isExcludedByCommunity && deal.isSuspiciousLow && (
                  <div className="mt-1.5 rounded bg-amber-500/15 px-2 py-1 text-[11px] text-amber-200">
                    سعر منخفض جداً مقارنة بالمتوسط — يُنصح بالتحقق من أبناء الحي
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 2. المتاجر والمراكز في المنطقة ورأي أصحاب الحي */}
      <section className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-900/75 p-4 text-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-white">
            المتاجر والمراكز {activeZone ? `في (${activeZone})` : '(كل المناطق)'}
          </h2>
          <span className="text-xs text-slate-400">
            يتم استبعاد المركز تلقائياً إذا أبلغ 3 أشخاص أو أكثر بأنه مخادع أو غير مطابق
          </span>
        </div>

        {zonePlaces.length === 0 ? (
          <p className="text-xs text-slate-400">
            لم يتم رصد متاجر أو مراكز مسجلة في هذا النطاق بعد. أضف بلاغاً باسم المركز أو البقالة ليظهر هنا.
          </p>
        ) : (
          <div className="space-y-2.5">
            {zonePlaces.map((place) => {
              const isSelected = selectedPlaceKey === place.placeKey;
              return (
                <div
                  key={place.placeKey}
                  className={`rounded-lg border p-3 text-xs ${
                    place.isExcluded
                      ? 'border-rose-500/40 bg-rose-950/20 opacity-85'
                      : 'border-slate-800 bg-slate-950/60'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-bold text-white">{place.placeName}</span>
                      <span className="mr-2 text-slate-400">({place.location})</span>
                    </div>

                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                        place.isExcluded
                          ? 'bg-rose-500/20 text-rose-200'
                          : place.statusLabel === 'معتمد ومخفض'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : place.statusLabel === 'مرتفع السعر'
                              ? 'bg-amber-500/20 text-amber-200'
                              : 'bg-sky-500/15 text-sky-300'
                      }`}
                    >
                      {place.statusLabel}
                    </span>
                  </div>

                  <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-slate-300">
                    <span>البلاغات: {place.entriesCount}</span>
                    {place.lowestPrice !== null && <span>أقل سعر: {place.lowestPrice}</span>}
                    {place.avgPrice !== null && <span>المتوسط: {place.avgPrice}</span>}
                    <span className="text-emerald-300">صادق/مخفض: {place.honestLowCount}</span>
                    <span className="text-sky-300">عادل: {place.fairCount}</span>
                    <span className="text-amber-300">مرتفع: {place.expensiveCount}</span>
                    <span className="text-rose-300">
                      خداع/غير مطابق: {place.deceptiveCount} ({place.uniqueDeceptiveReporters} مُبلّغ)
                    </span>
                  </div>

                  {place.sampleItems.length > 0 && (
                    <div className="mt-1 text-[11px] text-slate-400">
                      أبرز السلع: {place.sampleItems.join('، ')}
                    </div>
                  )}

                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleFeedback(place.placeName, place.location, 'honest_low')}
                        className="rounded bg-emerald-600/80 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-600"
                      >
                        مخفض وصادق
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFeedback(place.placeName, place.location, 'fair')}
                        className="rounded bg-sky-600/80 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-600"
                      >
                        سعر عادل
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFeedback(place.placeName, place.location, 'expensive')}
                        className="rounded bg-amber-600/80 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-600"
                      >
                        سعره غالي
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFeedback(place.placeName, place.location, 'deceptive')}
                        className="rounded bg-rose-600/80 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-rose-600"
                      >
                        إبلاغ خداع / غير مطابق
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setSelectedPlaceKey(isSelected ? '' : place.placeKey)
                      }
                      className="text-[11px] text-slate-400 underline hover:text-slate-200"
                    >
                      {isSelected ? 'إخفاء الملاحظة' : 'إضافة سبب/ملاحظة'}
                    </button>
                  </div>

                  {isSelected && (
                    <div className="mt-2 flex gap-2">
                      <input
                        type="text"
                        value={reasonText}
                        onChange={(e) => setReasonText(e.target.value)}
                        placeholder="مثال: أعلن عن سكر بسعر منخفض وعند الوصول السعر أعلى..."
                        className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white focus:border-emerald-400 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleFeedback(place.placeName, place.location, 'deceptive')}
                        className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500"
                      >
                        تأكيد بلاغ الخداع
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
