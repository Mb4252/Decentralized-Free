'use client';

import { useState } from 'react';
import { useApp } from '@/lib/context';
import { PriceTag } from '@/core/market-engine';

const DEFAULT_ITEMS = ['دقيق', 'سكر', 'زيت', 'ذرة'];

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
  const [selectedItem, setSelectedItem] = useState<string>('دقيق');

  const extraItems = Array.from(
    new Set(
      entries
        .filter((e) => e.kind === 'price')
        .map((e) => e.item.trim())
        .filter((name) => name && !DEFAULT_ITEMS.includes(name))
    )
  );

  const allItems = [...DEFAULT_ITEMS, ...extraItems];
  const activeAnalysis = getItemAnalysis(selectedItem);

  return (
    <div className="mt-4 space-y-5 pb-24">
      <div className="card space-y-1">
        <h1 className="text-xl font-bold text-slate-900">رادار السعر العادل</h1>
        <p className="text-sm text-slate-600">
          الوسيط الحسابي (Median) يقاوم الأسعار الشاذة، مع توضيح حالة كل بلاغ وهوية المُبلِغ.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {allItems.map((item) => {
          const analysis = getItemAnalysis(item);
          const isSelected = selectedItem === item;
          return (
            <button
              key={item}
              type="button"
              onClick={() => setSelectedItem(item)}
              className={`card text-right transition ${
                isSelected ? 'border-teal-600 ring-2 ring-teal-500/20' : 'hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-base text-slate-900">{item}</span>
                <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-medium">
                  {analysis.reports.length} بلاغ
                </span>
              </div>

              {analysis.median !== null ? (
                <div className="mt-2 text-xl font-bold text-teal-700">
                  {analysis.median} جنيه
                </div>
              ) : (
                <div className="mt-2 text-xs text-slate-400">
                  لا توجد بلاغات كافية لحساب السعر.
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="card space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h2 className="font-bold text-slate-900">تفاصيل بلاغات: {selectedItem}</h2>
          {activeAnalysis.median !== null && (
            <span className="text-xs font-semibold text-teal-700">
              الوسيط: {activeAnalysis.median} جنيه
            </span>
          )}
        </div>

        {activeAnalysis.reports.length === 0 ? (
          <p className="text-sm text-slate-500">لا توجد بلاغات مسجلة لهذه السلعة بعد.</p>
        ) : (
          <div className="space-y-2.5">
            {activeAnalysis.reports.map((report) => {
              const sign = report.deviationPercent > 0 ? '+' : '';
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
                    <span
                      className={`text-xs px-2 py-0.5 rounded border font-semibold ${badgeStyle(
                        report.tag
                      )}`}
                    >
                      {report.tag}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 flex flex-wrap gap-x-3 gap-y-1">
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
        )}
      </div>
    </div>
  );
}
