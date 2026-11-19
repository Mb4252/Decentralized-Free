'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/context';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_SAMPLE_ITEMS,
  ReportKind,
} from '@/core/market-engine';

export default function AddPage() {
  const router = useRouter();
  const { addEntry, localPeer, exportBundleJson, importBundleJson } = useApp();

  const [step, setStep] = useState<1 | 2>(1);
  const [kind, setKind] = useState<ReportKind>('price');
  const [category, setCategory] = useState<string>('بقالة');
  const [item, setItem] = useState<string>('دقيق');

  const [placeName, setPlaceName] = useState<string>('');
  const [authorName, setAuthorName] = useState<string>(localPeer.defaultName);
  const [location, setLocation] = useState<string>('الخرطوم');
  const [contact, setContact] = useState<string>('');
  const [price, setPrice] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('1 كجم');
  const [wantItem, setWantItem] = useState<string>('');
  const [note, setNote] = useState<string>('');

  const [bundleText, setBundleText] = useState<string>('');
  const [bundleStatus, setBundleStatus] = useState<string>('');

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();
    if (!item.trim()) return;
    if (!category.trim()) {
      setCategory('عام');
    }
    if (!authorName.trim()) {
      setAuthorName(localPeer.defaultName);
    }
    setStep(2);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!item.trim()) return;

    const numericPrice = kind === 'price' ? Number(price) : undefined;
    if (kind === 'price' && (!numericPrice || Number.isNaN(numericPrice) || numericPrice <= 0)) {
      return;
    }

    addEntry({
      kind,
      category: category.trim() || 'عام',
      item: item.trim(),
      placeName: placeName.trim() || undefined,
      location: location.trim() || 'غير محدد',
      contact: contact.trim() || undefined,
      price: numericPrice,
      quantity: kind !== 'price' ? quantity.trim() || undefined : undefined,
      wantItem: kind !== 'price' ? wantItem.trim() || undefined : undefined,
      note: note.trim() || undefined,
      authorName: authorName.trim() || localPeer.defaultName,
    });

    if (kind === 'price') {
      router.push('/prices');
    } else {
      router.push('/barter');
    }
  };

  return (
    <div className="mt-4 space-y-5 pb-24">
      <div className="card space-y-1">
        <h1 className="text-xl font-bold text-slate-900">إضافة مجتمعية سريعة</h1>
        <p className="text-xs text-slate-500">
          هويتك اللامركزية المحلية: <strong>{localPeer.defaultName}</strong> ({localPeer.peerId})
        </p>
      </div>

      {step === 1 ? (
        <form onSubmit={handleNext} className="card space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-bold text-slate-800">ماذا تريد أن تضيف؟</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setKind('price')}
                className={`p-3 rounded-lg border text-sm font-bold transition ${
                  kind === 'price'
                    ? 'bg-teal-50 border-teal-600 text-teal-800'
                    : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                بلاغ سعر
              </button>
              <button
                type="button"
                onClick={() => setKind('have')}
                className={`p-3 rounded-lg border text-sm font-bold transition ${
                  kind === 'have'
                    ? 'bg-teal-50 border-teal-600 text-teal-800'
                    : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                أملك (عرض)
              </button>
              <button
                type="button"
                onClick={() => setKind('need')}
                className={`p-3 rounded-lg border text-sm font-bold transition ${
                  kind === 'need'
                    ? 'bg-teal-50 border-teal-600 text-teal-800'
                    : 'bg-white border-slate-200 text-slate-700'
                }`}
              >
                أحتاج (طلب)
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-bold text-slate-800">
              التصنيف (بقالة، محاصيل، مغالق، أدوات كهربائية، مراكز تجارية، أو أي فئة جديدة)
            </label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="اكتب أي تصنيف يضيفه المجتمع..."
              className="w-full p-2.5 rounded-lg border border-slate-300 text-sm"
              required
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {DEFAULT_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`text-xs px-2.5 py-1 rounded-full transition ${
                    category === cat
                      ? 'bg-teal-700 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-bold text-slate-800">
              السلعة أو الخدمة أو المركز
            </label>
            <input
              type="text"
              value={item}
              onChange={(e) => setItem(e.target.value)}
              placeholder="مثال: دقيق، سكر، مغلق، كابل كهربائي، مركز..."
              className="w-full p-2.5 rounded-lg border border-slate-300 text-sm"
              required
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {DEFAULT_SAMPLE_ITEMS.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => setItem(sample)}
                  className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  {sample}
                </button>
              ))}
            </div>
          </div>

          <button type="submit" className="btn-primary w-full py-2.5">
            التالي
          </button>
        </form>
      ) : (
        <form onSubmit={handleSave} className="card space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-sm font-bold text-teal-800">
              {category} — {item}
            </span>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="text-xs text-slate-500 hover:underline"
            >
              ← رجوع
            </button>
          </div>

          {kind === 'price' ? (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">السعر (بالجنيه)</label>
              <input
                type="number"
                min="1"
                step="any"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="مثال: 15000"
                className="w-full p-2.5 rounded-lg border border-slate-300 text-sm"
                required
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الكمية أو الوصف</label>
                <input
                  type="text"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="مثال: 1 كجم أو جوال أو قطعة"
                  className="w-full p-2.5 rounded-lg border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  المقابل المطلوب (اختياري للمطابقة المتبادلة)
                </label>
                <input
                  type="text"
                  value={wantItem}
                  onChange={(e) => setWantItem(e.target.value)}
                  placeholder="مثال: سكر أو ذرة أو أداة كهربائية"
                  className="w-full p-2.5 rounded-lg border border-slate-300 text-sm"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              اسم المركز التجاري أو المحل أو نقطة البيع (اختياري)
            </label>
            <input
              type="text"
              value={placeName}
              onChange={(e) => setPlaceName(e.target.value)}
              placeholder="مثال: مركز النيل، مغالق السوق، محل الأنوار للكهرباء"
              className="w-full p-2.5 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">الاسم أو اللقب الظاهر</label>
            <input
              type="text"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="اسمك أو لقبك"
              className="w-full p-2.5 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">الموقع / الحي</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="مثال: الخرطوم"
              className="w-full p-2.5 rounded-lg border border-slate-300 text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              وسيلة تواصل (اختياري)
            </label>
            <input
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="رقم هاتف أو واتساب أو معرف تليجرام"
              className="w-full p-2.5 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظة أو رأي المجتمع (اختياري)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="مثال: جودة ممتازة وسعر منافس مقارنة ببقية المحلات"
              className="w-full p-2.5 rounded-lg border border-slate-300 text-sm"
            />
          </div>

          <button type="submit" className="btn-primary w-full py-2.5">
            حفظ ونشر
          </button>
        </form>
      )}

      <div className="card space-y-2.5">
        <h2 className="text-sm font-bold text-slate-900">
          مزامنة حزم البيانات بين أعضاء المجتمع (JSON بدون خادم مركزي)
        </h2>
        <p className="text-xs text-slate-500">
          صدّر حزمة JSON لمشاركتها مع غيرك، أو الصق حزمة واردة لدمج بلاغات وعروض المجتمع في جهازك.
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              const exported = exportBundleJson();
              setBundleText(exported);
              setBundleStatus('تم توليد حزمة JSON للبيانات الحالية.');
            }}
            className="px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-semibold"
          >
            تصدير حزمة JSON
          </button>
          <button
            type="button"
            onClick={() => {
              const res = importBundleJson(bundleText);
              if (res.ok) {
                setBundleStatus(`تم استيراد ${res.importedCount} عنصر جديد بنجاح.`);
              } else {
                setBundleStatus(res.error || 'تعذر الاستيراد.');
              }
            }}
            className="px-3 py-2 rounded-lg bg-teal-700 text-white text-xs font-semibold"
          >
            استيراد حزمة JSON
          </button>
        </div>

        <textarea
          rows={4}
          value={bundleText}
          onChange={(e) => setBundleText(e.target.value)}
          placeholder="الصق هنا حزمة JSON أو اضغط تصدير..."
          className="w-full p-2 rounded-lg border border-slate-300 text-xs font-mono"
        />

        {bundleStatus && <p className="text-xs font-medium text-teal-800">{bundleStatus}</p>}
      </div>
    </div>
  );
}
