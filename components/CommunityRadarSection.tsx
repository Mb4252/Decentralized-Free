'use client';

import React, { useMemo, useState } from 'react';
import { useApp } from '@/lib/context';
import { PlaceFeedbackVerdict } from '@/core/market-intelligence';

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

export function CommunityRadarSection() {
  const {
    lowestPriceDeals,
    zonePlaces,
    activeZone,
    submitPlaceFeedback,
    exportJsonBundle,
    importJsonBundle,
  } = useApp();

  const [selectedPlaceKey, setSelectedPlaceKey] = useState<string>('');
  const [reasonText, setReasonText] = useState<string>('');
  const [noticeMessage, setNoticeMessage] = useState<string>('');

  const showNotice = (msg: string) => {
    setNoticeMessage(msg);
    setTimeout(() => {
      setNoticeMessage((prev) => (prev === msg ? '' : prev));
    }, 3500);
  };

  const bestTrustedDeal = useMemo(() => {
    return (
      lowestPriceDeals.find((d) => !d.isExcludedByCommunity && !d.isSuspiciousLow) ||
      lowestPriceDeals.find((d) => !d.isExcludedByCommunity) ||
      null
    );
  }, [lowestPriceDeals]);

  const handleFeedback = (
    placeName: string,
    location: string,
    verdict: PlaceFeedbackVerdict
  ) => {
    const res = submitPlaceFeedback({
      placeName,
      location,
      verdict,
      reason: reasonText,
    });
    if (res) {
      setReasonText('');
      showNotice(`تم تسجيل رأي المجتمع حول «${placeName}».`);
    }
  };

  const handleCopyWhatsAppSummary = async () => {
    const validDeals = lowestPriceDeals.filter((d) => !d.isExcludedByCommunity);
    const zoneTitle = activeZone ? `منطقة: ${activeZone}` : 'جميع المناطق';
    const lines: string[] = [
      `📡 *رادار السعر العادل — ${zoneTitle}*`,
      `📅 تحديث: ${new Date().toLocaleDateString('ar-EG')}`,
      '',
    ];

    if (validDeals.length === 0) {
      lines.push('لا توجد عروض أسعار مسجلة بعد في هذا النطاق.');
    } else {
      lines.push('🏷️ *أقل الأسعار المرصودة اليوم:*');
      validDeals.slice(0, 10).forEach((deal, idx) => {
        const placePart = deal.placeName ? ` (${deal.placeName})` : '';
        const discPart =
          deal.discountPercent > 0 ? ` — أقل من الوسيط بـ ${deal.discountPercent}%` : '';
        lines.push(
          `${idx + 1}. *${deal.item}*: ${deal.price}${placePart} [${deal.location}]${discPart}`
        );
      });
    }

    if (typeof window !== 'undefined') {
      lines.push(
        '',
        '🔗 افتح الرادار وأضف أسعار منطقتك:',
        window.location.origin + window.location.pathname
      );
    }

    const text = lines.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showNotice('تم نسخ ملخص أسعار اليوم؛ يمكنك لصقه مباشرة في واتساب.');
    } catch {
      showNotice('تعذر النسخ التلقائي من المتصفح؛ جرّب مرة أخرى.');
    }
  };

  const handleTriggerLocalRefresh = () => {
    const bundle = exportJsonBundle();
    importJsonBundle(bundle);
    showNotice('تمت إعادة مزامنة الحالة وبثها للأقران المتصلين.');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/90 p-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCopyWhatsAppSummary}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            مشاركة أسعار اليوم (نسخ لواتساب)
          </button>
          <button
            type="button"
            onClick={handleTriggerLocalRefresh}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
          >
            إعادة مزامنة الأقران الآن
          </button>
        </div>
        {noticeMessage && (
          <span className="rounded-md bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
            {noticeMessage}
          </span>
        )}
      </div>

      {bestTrustedDeal && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3.5 text-xs text-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-emerald-300">
              ⭐ أبرز سعر أقل من الوسيط اليوم: {bestTrustedDeal.item} ({bestTrustedDeal.price})
            </span>
            <span className="text-slate-300">
              {bestTrustedDeal.placeName ? `${bestTrustedDeal.placeName} — ` : ''}
              {bestTrustedDeal.location}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-emerald-200">
            <span>
              {bestTrustedDeal.discountPercent > 0
                ? `أقل من الوسيط السعري بـ ${bestTrustedDeal.discountPercent}% (الوسيط: ${bestTrustedDeal.medianPrice})`
                : `الوسيط: ${bestTrustedDeal.medianPrice ?? '-'}`}
            </span>
            <span className="text-slate-400">
              نُشر: {formatPublishedAt(bestTrustedDeal.entry.createdAt)}
            </span>
          </div>
        </div>
      )}

      <section className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-900/85 p-4 text-slate-100">
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
            لا توجد بلاغات أسعار بعد. أضف أسعار اليوم من زر «إضافة» بالأسفل ليبدأ الرصد.
          </p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {lowestPriceDeals.slice(0, 6).map((deal) => (
              <div
                key={deal.id}
                className={`rounded-lg border p-3 text-xs ${
                  deal.isExcludedByCommunity
                    ? 'border-rose-500/40 bg-rose-950/30 text-rose-200'
                    : 'border-slate-800 bg-slate-950/75 text-slate-200'
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
                    <span className="text-emerald-300">
                      أقل من الوسيط بـ {deal.discountPercent}%
                    </span>
                  )}
                </div>

                <div className="mt-1 text-[10px] text-slate-500">
                  نُشر: {formatPublishedAt(deal.entry.createdAt)}
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

      <section className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-900/85 p-4 text-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-white">
            المتاجر والمراكز {activeZone ? `في (${activeZone})` : '(كل المناطق)'}
          </h2>
          <span className="text-xs text-slate-400">
            يُستبعد المركز تلقائياً عند إبلاغ 3 أشخاص أو أكثر بأنه مخادع
          </span>
        </div>

        {zonePlaces.length === 0 ? (
          <p className="text-xs text-slate-400">
            لم يتم رصد متاجر أو مراكز بعد. عند إضافة بلاغ وكتابة اسم المركز أو البقالة سيظهر هنا تلقائياً.
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
                      ? 'border-rose-500/40 bg-rose-950/25 opacity-90'
                      : 'border-slate-800 bg-slate-950/70'
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
                        className="rounded bg-emerald-600/85 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-600"
                      >
                        مخفض وصادق
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFeedback(place.placeName, place.location, 'fair')}
                        className="rounded bg-sky-600/85 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-600"
                      >
                        سعر عادل
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFeedback(place.placeName, place.location, 'expensive')}
                        className="rounded bg-amber-600/85 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-600"
                      >
                        سعره غالي
                      </button>
                      <button
                        type="button"
                        onClick={() => handleFeedback(place.placeName, place.location, 'deceptive')}
                        className="rounded bg-rose-600/85 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-rose-600"
                      >
                        إبلاغ خداع / غير مطابق
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedPlaceKey(isSelected ? '' : place.placeKey)}
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
