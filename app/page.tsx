'use client';

import React, { useMemo, useState } from 'react';
import { GeoFocusBanner } from '@/components/GeoFocusBanner';
import { CommunityRadarSection } from '@/components/CommunityRadarSection';
import { useApp } from '@/lib/context';

type HomeSectionTab = 'categories' | 'prices' | 'barter' | 'stores';

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

export default function HomePage() {
  const {
    entries,
    priceSummaries,
    barterMatches,
    lowestPriceDeals,
    nodeStatus,
    activeZone,
    canDeleteEntry,
    deleteEntry,
  } = useApp();

  const [activeTab, setActiveTab] = useState<HomeSectionTab>('categories');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [actionMsg, setActionMsg] = useState<string>('');

  const displayZone = cleanZoneOnly(activeZone);

  const categories = useMemo(() => {
    const list: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const cat = (entries[i].category || 'عام').trim();
      if (cat && list.indexOf(cat) === -1) {
        list.push(cat);
      }
    }
    return list;
  }, [entries]);

  const effectiveCategory = useMemo(() => {
    if (categories.length === 0) return '';
    if (selectedCategory && categories.indexOf(selectedCategory) !== -1) {
      return selectedCategory;
    }
    return categories[0];
  }, [categories, selectedCategory]);

  const categoryEntries = useMemo(() => {
    if (!effectiveCategory) return [];
    return entries.filter((e) => (e.category || 'عام').trim() === effectiveCategory);
  }, [entries, effectiveCategory]);

  const priceEntries = useMemo(() => {
    return entries.filter((e) => e.kind === 'price');
  }, [entries]);

  const barterEntries = useMemo(() => {
    return entries.filter((e) => e.kind === 'have' || e.kind === 'need');
  }, [entries]);

  const handleDelete = (id: string, itemName: string) => {
    deleteEntry(id);
    setActionMsg(`تم حذف منشور «${itemName}».`);
    setTimeout(() => setActionMsg(''), 3000);
  };

  const renderEntryCard = (entry: (typeof entries)[number]) => {
    const owned = canDeleteEntry(entry);
    const note = getEntryNote(entry);
    const phone = getEntryPhone(entry);
    const zoneLabel = cleanZoneOnly(entry.location, entry.placeName);

    return (
      <li
        key={entry.id}
        className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm sm:flex-row sm:items-start sm:justify-between"
      >
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-white">{entry.item}</span>
            {zoneLabel && (
              <span className="rounded bg-emerald-950 border border-emerald-500/30 px-2 py-0.5 text-[11px] text-emerald-300">
                📍 {zoneLabel}
              </span>
            )}
            {entry.placeName && (
              <span className="rounded bg-amber-950 border border-amber-500/30 px-2 py-0.5 text-[11px] text-amber-300">
                🏪 {entry.placeName}
              </span>
            )}
            {entry.category && (
              <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-200">
                {entry.category}
              </span>
            )}
          </div>

          {note && (
            <div className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200">
              📝 ملاحظة: {note}
            </div>
          )}

          {phone && (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <a
                href={`tel:${phone}`}
                className="rounded bg-sky-700 px-2.5 py-0.5 text-[11px] font-medium text-white hover:bg-sky-600"
              >
                📞 اتصال: {phone}
              </a>
              <a
                href={`https://wa.me/${phone.replace(/[^\d]/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded bg-emerald-700 px-2.5 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-600"
              >
                💬 واتساب
              </a>
            </div>
          )}

          <div className="text-[11px] text-slate-400">
            نُشر: {formatPublishedAt(entry.createdAt)}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <span className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-bold text-emerald-300">
            {entry.kind === 'price' && typeof entry.price === 'number'
              ? `${entry.price}`
              : entry.wantItem || entry.kind}
          </span>
          {owned && (
            <button
              type="button"
              onClick={() => handleDelete(entry.id, entry.item)}
              className="rounded-lg border border-rose-500/50 bg-rose-950/60 px-2.5 py-1 text-[11px] text-rose-200 hover:bg-rose-900/70"
            >
              حذف
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <main dir="rtl" className="mx-auto max-w-4xl space-y-4 p-4 text-slate-100">
      <GeoFocusBanner />

      {/* مؤشرات سريعة */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
          <div className="text-xs text-slate-400">إجمالي البلاغات</div>
          <div className="mt-1 text-xl font-bold text-white">{entries.length}</div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
          <div className="text-xs text-slate-400">عروض أقل سعر</div>
          <div className="mt-1 text-xl font-bold text-emerald-300">
            {lowestPriceDeals.filter((d) => !d.isExcludedByCommunity).length}
          </div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
          <div className="text-xs text-slate-400">مطابقات المقايضة</div>
          <div className="mt-1 text-xl font-bold text-white">{barterMatches.length}</div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
          <div className="text-xs text-slate-400">الأقران المتصلون</div>
          <div className="mt-1 text-xl font-bold text-white">{nodeStatus.connectedPeers}</div>
        </div>
      </div>

      {/* شريط الأقسام الرئيسية حتى لا يختلط كل شيء على المستخدم */}
      <nav className="grid grid-cols-2 gap-2 rounded-xl border border-slate-700 bg-slate-900 p-2 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => setActiveTab('categories')}
          className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
            activeTab === 'categories'
              ? 'bg-emerald-600 text-white'
              : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
          }`}
        >
          🗂️ أقسام التصنيفات ({categories.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('prices')}
          className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
            activeTab === 'prices'
              ? 'bg-emerald-600 text-white'
              : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
          }`}
        >
          🏷️ أقل الأسعار ({priceEntries.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('stores')}
          className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
            activeTab === 'stores'
              ? 'bg-emerald-600 text-white'
              : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
          }`}
        >
          🏪 المتاجر والسمعة
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('barter')}
          className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
            activeTab === 'barter'
              ? 'bg-emerald-600 text-white'
              : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
          }`}
        >
          🤝 المقايضة ({barterEntries.length})
        </button>
      </nav>

      {actionMsg && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/70 px-3.5 py-2 text-xs text-rose-200">
          {actionMsg}
        </div>
      )}

      {/* القسم 1: أقسام التصنيفات (كل تصنيف في قسمه الخاص دون خلط) */}
      {activeTab === 'categories' && (
        <section className="space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-white">
              أقسام التصنيفات {displayZone ? `— ${displayZone}` : '— كل المناطق'}
            </h2>
            <span className="text-xs text-slate-400">
              اختر قسماً لعرض منشوراته فقط
            </span>
          </div>

          {categories.length === 0 ? (
            <p className="text-sm text-slate-400">
              لا توجد بلاغات بعد. اضغط «إضافة» بالأسفل لإضافة أول سعر أو عرض في القسم المناسب.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => {
                  const count = entries.filter((e) => (e.category || 'عام').trim() === cat).length;
                  const isCurrent = effectiveCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                        isCurrent
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'border border-slate-700 bg-slate-950 text-slate-200 hover:border-slate-500'
                      }`}
                    >
                      {cat} ({count})
                    </button>
                  );
                })}
              </div>

              <div className="pt-1">
                <div className="mb-2 text-xs font-semibold text-emerald-300">
                  قسم: {effectiveCategory} ({categoryEntries.length})
                </div>
                <ul className="space-y-2.5">{categoryEntries.map(renderEntryCard)}</ul>
              </div>
            </>
          )}
        </section>
      )}

      {/* القسم 2: أقل الأسعار والمشاركة */}
      {activeTab === 'prices' && (
        <section className="space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-4">
          <h2 className="text-base font-bold text-emerald-300">
            قسم أقل الأسعار والمشاركة {displayZone ? `— ${displayZone}` : ''}
          </h2>
          <CommunityRadarSection mode="deals-only" />
        </section>
      )}

      {/* القسم 3: المتاجر وتقييم السمعة */}
      {activeTab === 'stores' && (
        <section className="space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-4">
          <h2 className="text-base font-bold text-white">
            قسم المتاجر والمراكز وتقييم الحي {displayZone ? `— ${displayZone}` : ''}
          </h2>
          <CommunityRadarSection mode="places-only" />
        </section>
      )}

      {/* القسم 4: المقايضة والعروض والطلبات */}
      {activeTab === 'barter' && (
        <section className="space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-4">
          <h2 className="text-base font-bold text-emerald-300">
            قسم المقايضة ({barterEntries.length})
          </h2>
          {barterEntries.length === 0 ? (
            <p className="text-sm text-slate-400">
              لا توجد عروض أو طلبات مقايضة مسجلة حالياً.
            </p>
          ) : (
            <ul className="space-y-2.5">{barterEntries.map(renderEntryCard)}</ul>
          )}
        </section>
      )}

      <div className="text-xs text-slate-400">
        عدد السلع المحللة في مؤشر الأسعار: {priceSummaries.length}
      </div>
    </main>
  );
}
