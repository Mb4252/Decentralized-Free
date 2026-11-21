'use client';

import React, { useMemo, useState } from 'react';
import { useApp } from '@/lib/context';
import { PlaceFeedbackVerdict } from '@/core/market-intelligence';

interface CommunityRadarSectionProps {
  mode?: 'all' | 'deals-only' | 'places-only';
}

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

function cleanZoneOnly(zone?: string | null, placeName?: string): string {
  if (!zone) return '';
  let text = zone.trim();
  if (placeName && placeName.trim()) {
    const escaped = placeName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`\\s*-\\s*${escaped}$`), '').trim();
  }
  const dashParts = text.split(' - ');
  if (dashParts.length > 1) {
    const lastPart = dashParts[dashParts.length - 1].trim();
    if (/^(دكان|مركز|محل|مغلق|بقالة|صيدلية|ورشة|سوق)\b/i.test(lastPart)) {
      text = dashParts.slice(0, -1).join(' - ').trim();
    }
  }
  return text;
}

function normalizeSourceKey(name?: string): string {
  return (name || '')
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function isGeneralLabel(placeName?: string): boolean {
  const k = normalizeSourceKey(placeName);
  return k === 'الجميع' || k === 'عام' || k === 'شخصي' || k === 'خاص';
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
  return extractPhone(getEntryNote(entry));
}

export function CommunityRadarSection({ mode = 'all' }: CommunityRadarSectionProps) {
  const {
    entries,
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
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'trusted' | 'excluded'>('all');

  const displayZone = cleanZoneOnly(activeZone);
  const showDeals = mode === 'all' || mode === 'deals-only';
  const showPlaces = mode === 'all' || mode === 'places-only';

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

  const filteredDeals = useMemo(() => {
    const q = normalizeSourceKey(searchQuery);
    return lowestPriceDeals.filter((deal) => {
      if (!q) return true;
      return (
        normalizeSourceKey(deal.item).includes(q) ||
        normalizeSourceKey(deal.placeName).includes(q) ||
        normalizeSourceKey(deal.location).includes(q)
      );
    });
  }, [lowestPriceDeals, searchQuery]);

  const enrichedPlaces = useMemo(() => {
    const q = normalizeSourceKey(searchQuery);

    return zonePlaces
      .map((place) => {
        const placeNorm = normalizeSourceKey(place.placeName);
        const locNorm = normalizeSourceKey(cleanZoneOnly(place.location, place.placeName));

        const matchingEntries = entries.filter((e) => {
          const ePlaceNorm = normalizeSourceKey(e.placeName);
          const eLocNorm = normalizeSourceKey(cleanZoneOnly(e.location, e.placeName));
          const samePlace = Boolean(ePlaceNorm && placeNorm && ePlaceNorm === placeNorm);
          const sameLoc = !locNorm || !eLocNorm || eLocNorm === locNorm;
          return samePlace && sameLoc;
        });

        const itemDetails = matchingEntries.map((e) => ({
          id: e.id,
          item: e.item,
          kind: e.kind,
          price: typeof e.price === 'number' ? e.price : null,
          wantItem: e.wantItem,
          note: getEntryNote(e),
          phone: getEntryPhone(e),
          createdAt: e.createdAt,
        }));

        return {
          ...place,
          itemDetails,
        };
      })
      .filter((place) => {
        if (statusFilter === 'trusted' && place.isExcluded) return false;
        if (statusFilter === 'excluded' && !place.isExcluded) return false;
        if (!q) return true;
        const inPlace =
          normalizeSourceKey(place.placeName).includes(q) ||
          normalizeSourceKey(place.location).includes(q);
        const inItems = place.itemDetails.some((it) => normalizeSourceKey(it.item).includes(q));
        return inPlace || inItems;
      });
  }, [zonePlaces, entries, searchQuery, statusFilter]);

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
    const zoneTitle = displayZone ? `منطقة: ${displayZone}` : 'جميع المناطق';
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
        const cleanLoc = cleanZoneOnly(deal.location, deal.placeName);
        const placePart = deal.placeName ? ` — متجر/جهة: ${deal.placeName}` : '';
        const locPart = cleanLoc ? ` [${cleanLoc}]` : '';
        const discPart =
          deal.discountPercent > 0 ? ` (أقل من الوسيط بـ ${deal.discountPercent}%)` : '';
        const note = getEntryNote(deal.entry);
        const phone = getEntryPhone(deal.entry);
        lines.push(`${idx + 1}. *${deal.item}*: ${deal.price}${placePart}${locPart}${discPart}`);
        if (note) lines.push(`   📝 ملاحظة: ${note}`);
        if (phone) lines.push(`   📞 تواصل: ${phone}`);
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

  const handleCopyPlaceReport = async (place: (typeof enrichedPlaces)[number]) => {
    const cleanLoc = cleanZoneOnly(place.location, place.placeName);
    const lines: string[] = [
      `🏪 *تقرير ${place.placeName}* ${cleanLoc ? `(${cleanLoc})` : ''}`,
      `الحالة: ${place.statusLabel} | البلاغات: ${place.entriesCount}`,
    ];
    if (place.lowestPrice !== null || place.avgPrice !== null) {
      lines.push(`أقل سعر: ${place.lowestPrice ?? '-'} | المتوسط: ${place.avgPrice ?? '-'}`);
    }
    if (place.itemDetails.length > 0) {
      lines.push('السلع والعروض المسجلة:');
      place.itemDetails.forEach((it) => {
        const val =
          it.price !== null ? `${it.price}` : it.wantItem ? `مقابل: ${it.wantItem}` : it.kind;
        lines.push(`• *${it.item}* — ${val}`);
        if (it.note) lines.push(`  📝 ${it.note}`);
        if (it.phone) lines.push(`  📞 ${it.phone}`);
      });
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      showNotice(`تم نسخ تقرير «${place.placeName}» للواتساب.`);
    } catch {
      showNotice('تعذر النسخ التلقائي من المتصفح.');
    }
  };

  const handleTriggerLocalRefresh = () => {
    const bundle = exportJsonBundle();
    importJsonBundle(bundle);
    showNotice('تمت إعادة مزامنة الحالة وبثها للأقران المتصلين.');
  };

  const bestNote = bestTrustedDeal ? getEntryNote(bestTrustedDeal.entry) : '';
  const bestPhone = bestTrustedDeal ? getEntryPhone(bestTrustedDeal.entry) : null;

  return (
    <div className="space-y-4">
      {/* بحث سريع مشترك */}
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث باسم السلعة (مثل: دقيق، سكر، هاتف) أو المتجر أو الحي..."
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-400 focus:border-emerald-400 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700"
            >
              مسح البحث
            </button>
          )}
        </div>
      </div>

      {showDeals && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-700 bg-slate-900 p-3">
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
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700"
            >
              إعادة مزامنة الأقران الآن
            </button>
          </div>
          {noticeMessage && (
            <span className="rounded-md border border-emerald-500/40 bg-emerald-950 px-2.5 py-1 text-xs font-medium text-emerald-200">
              {noticeMessage}
            </span>
          )}
        </div>
      )}

      {showPlaces && !showDeals && noticeMessage && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-950 px-3 py-1.5 text-xs font-medium text-emerald-200">
          {noticeMessage}
        </div>
      )}

      {showDeals && bestTrustedDeal && (
        <div className="rounded-xl border border-emerald-500/50 bg-slate-950 p-4 text-xs text-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-bold text-emerald-300">
              ⭐ أبرز سعر أقل من الوسيط اليوم: {bestTrustedDeal.item} ({bestTrustedDeal.price})
            </span>
            <div className="flex flex-wrap gap-1.5">
              {cleanZoneOnly(bestTrustedDeal.location, bestTrustedDeal.placeName) && (
                <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-200">
                  📍 {cleanZoneOnly(bestTrustedDeal.location, bestTrustedDeal.placeName)}
                </span>
              )}
              {bestTrustedDeal.placeName && (
                <span className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-slate-200">
                  {isGeneralLabel(bestTrustedDeal.placeName)
                    ? `🏷️ ${bestTrustedDeal.placeName}`
                    : `🏪 ${bestTrustedDeal.placeName}`}
                </span>
              )}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300">
            <span>
              {bestTrustedDeal.discountPercent > 0
                ? `أقل من الوسيط السعري بـ ${bestTrustedDeal.discountPercent}% (الوسيط: ${bestTrustedDeal.medianPrice})`
                : `الوسيط: ${bestTrustedDeal.medianPrice ?? '-'}`}
            </span>
            <span className="text-slate-400">
              نُشر: {formatPublishedAt(bestTrustedDeal.entry.createdAt)}
            </span>
          </div>

          {bestNote && (
            <div className="mt-2 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-200">
              📝 ملاحظة: {bestNote}
            </div>
          )}

          {bestPhone && (
            <div className="mt-2 flex flex-wrap gap-2">
              <a
                href={`tel:${bestPhone}`}
                className="rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-500"
              >
                📞 اتصال: {bestPhone}
              </a>
              <a
                href={`https://wa.me/${bestPhone.replace(/[^\d]/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-600"
              >
                💬 واتساب
              </a>
            </div>
          )}
        </div>
      )}

      {showDeals && (
        <section className="space-y-2.5 rounded-xl border border-slate-700 bg-slate-950 p-4 text-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-emerald-300">
              أقل الأسعار والعروض المخفضة {displayZone ? `في (${displayZone})` : '(كل المناطق)'}
            </h3>
            <span className="text-xs text-slate-400">
              مقارنة بأقل سعر مرصود والوسيط السعري
            </span>
          </div>

          {filteredDeals.length === 0 ? (
            <p className="text-xs text-slate-400">
              لا توجد بلاغات أسعار مطابقة حالياً. أضف أسعار اليوم من زر «إضافة» بالأسفل ليبدأ الرصد.
            </p>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {filteredDeals.slice(0, 8).map((deal) => {
                const dealNote = getEntryNote(deal.entry);
                const dealPhone = getEntryPhone(deal.entry);
                const dealZone = cleanZoneOnly(deal.location, deal.placeName);
                return (
                  <div
                    key={deal.id}
                    className={`rounded-lg border p-3 text-xs ${
                      deal.isExcludedByCommunity
                        ? 'border-rose-500/50 bg-rose-950/40 text-rose-100'
                        : 'border-slate-800 bg-slate-900 text-slate-100'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-white">{deal.item}</span>
                      <span className="rounded bg-emerald-500/20 px-2 py-0.5 font-bold text-emerald-300">
                        {deal.price}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap gap-2 text-slate-300">
                      {dealZone && <span>📍 {dealZone}</span>}
                      {deal.placeName && (
                        <span className="text-amber-300">
                          {isGeneralLabel(deal.placeName)
                            ? `🏷️ ${deal.placeName}`
                            : `🏪 ${deal.placeName}`}
                        </span>
                      )}
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-300">
                      <span>
                        الوسيط: {deal.medianPrice ?? '-'} ({deal.reportsCountForItem} بلاغ)
                      </span>
                      {deal.discountPercent > 0 && (
                        <span className="font-semibold text-emerald-300">
                          أقل من الوسيط بـ {deal.discountPercent}%
                        </span>
                      )}
                    </div>

                    {dealNote && (
                      <div className="mt-1.5 rounded bg-slate-950 px-2 py-1 text-[11px] text-slate-200">
                        📝 {dealNote}
                      </div>
                    )}

                    {dealPhone && (
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        <a
                          href={`tel:${dealPhone}`}
                          className="rounded bg-sky-700 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-sky-600"
                        >
                          📞 {dealPhone}
                        </a>
                        <a
                          href={`https://wa.me/${dealPhone.replace(/[^\d]/g, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded bg-emerald-700 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-600"
                        >
                          💬 واتساب
                        </a>
                      </div>
                    )}

                    <div className="mt-1.5 text-[10px] text-slate-400">
                      نُشر: {formatPublishedAt(deal.entry.createdAt)}
                    </div>

                    {deal.isExcludedByCommunity && (
                      <div className="mt-1.5 rounded bg-rose-500/20 px-2 py-1 text-[11px] font-medium text-rose-200">
                        مستبعد مؤقتاً بناءً على بلاغات عدم المطابقة/الخداع من سكان المنطقة
                      </div>
                    )}

                    {!deal.isExcludedByCommunity && deal.isSuspiciousLow && (
                      <div className="mt-1.5 rounded bg-amber-500/20 px-2 py-1 text-[11px] text-amber-200">
                        سعر منخفض جداً مقارنة بالمتوسط — يُنصح بالتحقق من أبناء الحي
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {showPlaces && (
        <section className="space-y-3 rounded-xl border border-slate-700 bg-slate-950 p-4 text-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-white">
                المتاجر والمراكز والجهات {displayZone ? `في (${displayZone})` : '(كل المناطق)'}
              </h3>
              <p className="mt-0.5 text-[11px] text-slate-400">
                كل مركز أو جهة تعرض سلعها مع السعر أو المقابل بوضوح؛ ويُستبعد المركز تلقائياً عند إبلاغ 3 أشخاص أو أكثر بأنه مخادع.
              </p>
            </div>

            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`rounded-lg px-2.5 py-1 font-semibold ${
                  statusFilter === 'all'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                الكل
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('trusted')}
                className={`rounded-lg px-2.5 py-1 font-semibold ${
                  statusFilter === 'trusted'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                غير المستبعدة
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('excluded')}
                className={`rounded-lg px-2.5 py-1 font-semibold ${
                  statusFilter === 'excluded'
                    ? 'bg-rose-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                المستبعدة
              </button>
            </div>
          </div>

          {enrichedPlaces.length === 0 ? (
            <p className="text-xs text-slate-400">
              لا توجد مراكز أو جهات مطابقة حالياً. عند إضافة بلاغ وكتابة اسم المركز أو الجهة سيظهر هنا مع السلع وأسعارها.
            </p>
          ) : (
            <div className="space-y-3">
              {enrichedPlaces.map((place) => {
                const isSelected = selectedPlaceKey === place.placeKey;
                const cleanLoc = cleanZoneOnly(place.location, place.placeName);
                const generalSource = isGeneralLabel(place.placeName);

                return (
                  <div
                    key={place.placeKey}
                    className={`rounded-xl border p-3.5 text-xs ${
                      place.isExcluded
                        ? 'border-rose-500/50 bg-rose-950/35 text-rose-100'
                        : 'border-slate-800 bg-slate-900 text-slate-100'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-white">
                          {generalSource ? `🏷️ ${place.placeName}` : `🏪 ${place.placeName}`}
                        </span>
                        {cleanLoc && (
                          <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-emerald-300">
                            📍 {cleanLoc}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopyPlaceReport(place)}
                          className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700"
                        >
                          نسخ تقرير المركز
                        </button>
                        <span
                          className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                            place.isExcluded
                              ? 'bg-rose-500/25 text-rose-200'
                              : place.statusLabel === 'معتمد ومخفض'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : place.statusLabel === 'مرتفع السعر'
                                  ? 'bg-amber-500/20 text-amber-200'
                                  : 'bg-sky-500/20 text-sky-300'
                          }`}
                        >
                          {place.statusLabel}
                        </span>
                      </div>
                    </div>

                    {/* عرض السلع المسجلة في هذا المركز/الجهة بوضوح مع السعر/المقابل */}
                    {place.itemDetails.length > 0 ? (
                      <div className="mt-2.5 space-y-1.5 rounded-lg border border-slate-800 bg-slate-950 p-2.5">
                        <div className="text-[11px] font-bold text-emerald-300">
                          السلع والعروض المسجلة ({place.itemDetails.length}):
                        </div>
                        <ul className="divide-y divide-slate-800/80">
                          {place.itemDetails.map((it) => {
                            const valueText =
                              it.price !== null
                                ? `السعر: ${it.price}`
                                : it.wantItem
                                  ? `المقابل: ${it.wantItem}`
                                  : it.kind === 'have'
                                    ? 'أملك (عرض)'
                                    : it.kind === 'need'
                                      ? 'أحتاج (طلب)'
                                      : 'بلاغ';

                            return (
                              <li key={it.id} className="py-1.5 first:pt-0 last:pb-0">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-bold text-white">{it.item}</span>
                                  <span className="rounded bg-emerald-950 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
                                    {valueText}
                                  </span>
                                </div>
                                {it.note && (
                                  <div className="mt-1 text-[11px] text-slate-300">
                                    📝 {it.note}
                                  </div>
                                )}
                                {it.phone && (
                                  <div className="mt-1 flex flex-wrap gap-2">
                                    <a
                                      href={`tel:${it.phone}`}
                                      className="rounded bg-sky-700 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-sky-600"
                                    >
                                      📞 {it.phone}
                                    </a>
                                    <a
                                      href={`https://wa.me/${it.phone.replace(/[^\d]/g, '')}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="rounded bg-emerald-700 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-600"
                                    >
                                      💬 واتساب
                                    </a>
                                  </div>
                                )}
                                <div className="mt-0.5 text-[10px] text-slate-400">
                                  نُشر: {formatPublishedAt(it.createdAt)}
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : (
                      place.sampleItems.length > 0 && (
                        <div className="mt-1.5 text-[11px] text-slate-300">
                          السلع المسجلة: {place.sampleItems.join('، ')}
                        </div>
                      )
                    )}

                    <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-300">
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

                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleFeedback(place.placeName, place.location, 'honest_low')}
                          className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-500"
                        >
                          مخفض وصادق
                        </button>
                        <button
                          type="button"
                          onClick={() => handleFeedback(place.placeName, place.location, 'fair')}
                          className="rounded bg-sky-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-sky-500"
                        >
                          سعر عادل
                        </button>
                        <button
                          type="button"
                          onClick={() => handleFeedback(place.placeName, place.location, 'expensive')}
                          className="rounded bg-amber-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-500"
                        >
                          سعره غالي
                        </button>
                        <button
                          type="button"
                          onClick={() => handleFeedback(place.placeName, place.location, 'deceptive')}
                          className="rounded bg-rose-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-rose-500"
                        >
                          إبلاغ خداع / غير مطابق
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => setSelectedPlaceKey(isSelected ? '' : place.placeKey)}
                        className="text-[11px] text-slate-300 underline hover:text-white"
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
      )}
    </div>
  );
}
