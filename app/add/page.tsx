'use client';

import React, { useMemo, useState } from 'react';
import { useApp } from '@/lib/context';
import type { ReportKind } from '@/core/types';

const CATEGORIES = [
  'بقالة',
  'محاصيل',
  'مغالق',
  'أدوات كهربائية',
  'مراكز تجارية',
  'خدمات',
  'أخرى',
];

export default function AddPage() {
  const { addEntry, exportJsonBundle, importJsonBundle, defaultName } = useApp();

  const [kind, setKind] = useState<ReportKind>('price');
  const [category, setCategory] = useState<string>('بقالة');
  const [item, setItem] = useState<string>('');
  const [placeName, setPlaceName] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  const [wantItem, setWantItem] = useState<string>('');
  const [location, setLocation] = useState<string>('');
  const [price, setPrice] = useState<string>('');
  const [contact, setContact] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [msg, setMsg] = useState<string>('');
  const [importText, setImportText] = useState<string>('');
  const [exportText, setExportText] = useState<string>('');

  const canSubmit = useMemo(
    () => item.trim().length > 0 && location.trim().length > 0,
    [item, location]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    const created = addEntry({
      kind,
      category,
      item: item.trim(),
      placeName: placeName.trim() || undefined,
      quantity: quantity.trim() || undefined,
      wantItem: wantItem.trim() || undefined,
      location: location.trim(),
      price: kind === 'price' && price.trim() ? Number(price) : undefined,
      contact: contact.trim() || undefined,
      note: note.trim() || undefined,
      authorName: defaultName,
    });
    if (!created) {
      setMsg('تعذر الحفظ: تحقق من الحقول المطلوبة.');
      return;
    }
    setMsg('تم الحفظ محلياً وبثه للأقران.');
    setItem('');
    setPlaceName('');
    setQuantity('');
    setWantItem('');
    setPrice('');
    setContact('');
    setNote('');
    setTimeout(() => setMsg(''), 3000);
  };

  const handleExport = () => {
    const bundle = exportJsonBundle();
    setExportText(bundle);
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(bundle);
    }
  };

  const handleDownload = () => {
    const bundle = exportJsonBundle();
    const blob = new Blob([bundle], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `market-radar-bundle-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    if (!importText.trim()) {
      setMsg('الصق حزمة JSON للاستيراد.');
      return;
    }
    const res = importJsonBundle(importText);
    setMsg(res.message);
    if (res.ok) setImportText('');
    setTimeout(() => setMsg(''), 4000);
  };

  return (
    <main dir="rtl" className="mx-auto max-w-4xl space-y-4 p-4 text-slate-100">
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
        <h1 className="text-lg font-bold text-white">إضافة بلاغ / عرض / طلب</h1>
        <p className="mt-1 text-xs text-slate-400">
          كل البيانات تُحفظ محلياً في متصفحك وتُبث للأقران المتصلين. لا خادم مركزي.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-300">نوع الإدخال</label>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setKind('price')}
              className={`rounded-lg px-3 py-2 text-xs font-bold ${
                kind === 'price' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-300'
              }`}
            >
              بلاغ سعر
            </button>
            <button
              type="button"
              onClick={() => setKind('have')}
              className={`rounded-lg px-3 py-2 text-xs font-bold ${
                kind === 'have' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'
              }`}
            >
              أملك (عرض)
            </button>
            <button
              type="button"
              onClick={() => setKind('need')}
              className={`rounded-lg px-3 py-2 text-xs font-bold ${
                kind === 'need' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'
              }`}
            >
              أحتاج (طلب)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">التصنيف</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">
              السلعة أو الخدمة *
            </label>
            <input
              type="text"
              value={item}
              onChange={(e) => setItem(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">المركز / الجهة</label>
            <input
              type="text"
              value={placeName}
              onChange={(e) => setPlaceName(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">الموقع / الحي *</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
              required
            />
          </div>
        </div>

        {kind === 'price' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">السعر</label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                min="0"
                step="0.01"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">الكمية</label>
              <input
                type="text"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
              />
            </div>
          </div>
        )}

        {kind !== 'price' && (
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">المقابل / ما تريده</label>
            <input
              type="text"
              value={wantItem}
              onChange={(e) => setWantItem(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">وسيلة التواصل</label>
            <input
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="هاتف / واتساب"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-300">ملاحظة</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          حفظ وبث
        </button>

        {msg && (
          <div className="rounded-lg border border-emerald-500/40 bg-emerald-950 px-3 py-2 text-xs text-emerald-200">
            {msg}
          </div>
        )}
      </form>

      <section className="space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-4">
        <h2 className="text-base font-bold text-white">المزامنة عبر حزم JSON</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            تصدير الحزمة (نسخ)
          </button>
          <button
            type="button"
            onClick={handleDownload}
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-slate-700"
          >
            تنزيل ملف JSON
          </button>
        </div>

        {exportText && (
          <textarea
            value={exportText}
            readOnly
            rows={5}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-[11px] text-slate-200"
          />
        )}

        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-300">
            الصق حزمة JSON للاستيراد
          </label>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-[11px] text-slate-200"
          />
          <button
            type="button"
            onClick={handleImport}
            className="mt-2 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
          >
            استيراد
          </button>
        </div>
      </section>
    </main>
  );
}
