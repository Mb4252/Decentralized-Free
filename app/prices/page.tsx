'use client';

import { useMemo, useState } from 'react';
import { useApp } from '@/lib/context';
import { DEFAULT_CATEGORIES, PriceTag } from '@/core/market-engine';

function badgeStyle(tag: PriceTag): string {
  switch (tag) {
    case 'شاذ':
      return 'bg-red-100 text-red-800 border-red-300';
    case 'مرتفع':
      return 'bg-amber-100 text-amber-800 border-amber-300';
    case 'منخفض':
      return 'bg-sky-100 text-sky-800 border-sky-300';
    default:
      return 'bg-emerald-100 text-emerald-800 border-emerald-300';
  }
}

export default function PricesPage() {
  const { entries, getItemAnalysis, removeEntry } = useApp();
  const [selectedCategory, setSelectedCategory] = useState<string>('الكل');

  const priceEntries = useMemo(
    () => entries.filter((e) => e.kind === 'price'),
    [entries]
  );

  const categories = useMemo(() => {
    const customCats = priceEntries
      .map((e) => e.category?.trim())
      .filter((c): c is string => Boolean(c) && !DEFAULT_CATEGORIES.includes(c));
    return ['الكل', ...DEFAULT_CATEGORIES, ...Array.from(new Set(customCats))];
  }, [priceEntries]);

  const filteredItems = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of priceEntries) {
      const cat = entry.category?.trim() || 'عام';
      if (selectedCategory !== 'الكل' && cat !== selectedCategory) continue;
      if (!map.has(entry.item.trim())) {
        map.set(entry.item.trim(), cat);
      }
    }
    return Array.from(map.entries()).map(([item, category]) => ({ item, category }));
  }, [priceEntries, selectedCategory]);

  const [selectedItem, setSelectedItem] = useState<string>('');

  const activeItemName = useMemo(() => {
    if (selectedItem && filteredItems.some((x) => x.item === selectedItem)) {
      return selectedItem;
    }
    return filteredItems[0]?.item || '';
  }, [selectedItem, filteredItems]);

  const activeSummary = activeItemName ? getItemAnalysis(activeItemName) : null;

  return (
    <div className="mt-4 space-y-5 pb-24">
      <div className="card space-y-1">
        <h1 className="text-xl font-bold text-slate-900">رادار الأسعار والمقارنة المجتمعية</h1>
        <p className="text-sm text-slate-600">
          بلاغات المجتمع للسلع والخدمات والمراكز التجارية مرتبة من الأرخص إلى الأغلى مع الوسيط الحسابي (Median).
        </p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setSelectedCategory(cat)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border transition ${
              selectedCategory === cat
                ? 'bg-teal-700 text-white border-teal-700'
                : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {filteredItems.length === 0 ? (
        <div className="card text-sm text-slate-500">
          لا توجد بلاغات أسعار مسجلة في هذه الفئة بعد. أضف أول بلاغ من تبويب «إضافة».
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3">
            {filteredItems.map(({ item, category }) => {
              const summary = getItemAnalysis(item);
              const isSelected = activeItemName === item;

              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setSelectedItem(item)}
                  className={`card text-right space-y-2 transition ${
                    isSelected ? 'border-teal-600 ring-2 ring-teal-500/20' : 'hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold ml-2">
                        {category}
                      </span>
                      <span className="font-bold text-base text-slate-900">{item}</span>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-medium">
                      {summary.reports.length} بلاغ
                    </span>
                  </div>

                  {summary.median !== null && (
                    <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                      <div className="p-2 rounded bg-sky-50 border border-sky-100">
                        <div className="text-slate-500">الأرخص</div>
                        <div className="font-bold text-sky-900 mt-0.5">{summary.lowestPrice} جنيه</div>
                        {summary.cheapestPlace && (
                          <div className="text-[11px] text-sky-700 truncate">{summary.cheapestPlace}</div>
                        )}
                      </div>

                      <div className="p-2 rounded bg-teal-50 border border-teal-100">
                        <div className="text-slate-500">الوسيط العادل</div>
                        <div className="font-bold text-teal-900 mt-0.5">{summary.median} جنيه</div>
                        <div className="text-[11px] text-teal-700">مرجع المجتمع</div>
                      </div>

                      <div className="p-2 rounded bg-amber-50 border border-amber-100">
                        <div className="text-slate-500">الأغلى</div>
                        <div className="font-bold text-amber-900 mt-0.5">{summary.highestPrice} جنيه</div>
                        {summary.priciestPlace && (
                          <div className="text-[11px] text-amber-700 truncate">{summary.priciestPlace}</div>
                        )}
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {activeSummary && (
            <div className="card space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h2 className="font-bold text-slate-900">
                  آراء وبلاغات المجتمع لـ: {activeSummary.item}
                </h2>
                {activeSummary.median !== null && (
                  <span className="text-xs font-semibold text-teal-700">
                    الوسيط: {activeSummary.median} جنيه
                  </span>
                )}
              </div>

              <div className="space-y-2.5">
                {activeSummary.reports.map((report, idx) => {
                  const sign = report.deviationPercent > 0 ? '+' : '';
                  const rankLabel =
                    idx === 0
                      ? 'الأرخص حالياً'
                      : idx === activeSummary.reports.length - 1 && activeSummary.reports.length > 1
                      ? 'الأغلى حالياً'
                      : `بلاغ #${idx + 1}`;

                  return (
                    <div
                      key={report.id}
                      className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-bold text-slate-900">
                          {report.price} جنيه
                          <span className="text-xs font-normal text-slate-500 mr-2">
                            ({sign}
                            {report.deviationPercent}% عن الوسيط)
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] px-2 py-0.5 rounded bg-slate-200/80 text-slate-800 font-medium">
                            {rankLabel}
                          </span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded border font-semibold ${badgeStyle(
                              report.tag
                            )}`}
                          >
                            {report.tag}
                          </span>
                        </div>
                      </div>

                      <div className="text-xs text-slate-600 flex flex-wrap gap-x-3 gap-y-1">
                        {report.placeName && (
                          <span>
                            🏪 المكان/المركز: <strong>{report.placeName}</strong>
                          </span>
                        )}
                        <span>
                          المُبلِغ: <strong>{report.authorName}</strong> ({report.authorPeerId})
                        </span>
                        <span>📍 {report.location}</span>
                        {report.contact && <span>📞 {report.contact}</span>}
                      </div>

                      {report.note && <p className="text-xs text-slate-500">{report.note}</p>}

                      <div className="pt-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => removeEntry(report.id)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          حذف البلاغ
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
