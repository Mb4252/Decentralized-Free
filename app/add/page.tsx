'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/context';
import { ReportKind } from '@/core/market-engine';

const QUICK_ITEMS = ['دقيق', 'سكر', 'زيت', 'ذرة'];

export default function AddPage() {
  const router = useRouter();
  const { addEntry, localPeer, exportBundleJson, importBundleJson } = useApp();

  const [step, setStep] = useState<1 | 2>(1);
  const [kind, setKind] = useState<ReportKind>('price');
  const [item, setItem] = useState<string>('دقيق');

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
      item: item.trim(),
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
        <h1 className="text-xl font-bold text-slate-900">إضافة سريعة</h1>
        <p className="text-xs text-slate-500">
          معرّفك اللامركزي المحلي: <strong>{localPeer.peerId}</strong>
        </p>
      </div>

      {step === 1 ? (
        <form onSubmit={handleNext} className="card space-y-4">
          <div className="space-y-2">
            <label className="block text-sm font-bold text-slate-800">ماذا تريد أن تفعل؟</label>
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
            <label className="block text-sm font-bold text-slate-800">السلعة</label>
            <input
              type="text"
              value={item}
              onChange={(e) => setItem(e.target.value)}
              placeholder="مثال: دقيق، سكر، زيت..."
              className="w-full p-2.5 rounded-lg border border-slate-300 text-sm"
              required
            />
            <div className="flex flex-wrap gap-2 pt-1">
              {QUICK_ITEMS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setItem(q)}
                  className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  {q}
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
              {kind === 'price' ? 'تفاصيل بلاغ السعر' : kind === 'have' ? 'تفاصيل العرض' : 'تفاصيل الطلب'}: {item}
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
                  placeholder="مثال: 1 كجم أو جوال"
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
                  placeholder="مثال: سكر أو ذرة"
                  className="w-full p-2.5 rounded-lg border border-slate-300 text-sm"
                />
              </div>
            </>
          )}

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
              وسيلة تواصل (اختياري — تظهر عند التبديل أو المراجعة)
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
            <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظة إضافية (اختياري)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="مثال: متوفر قرب السوق المركزي"
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
          مشاركة ومزامنة البيانات محلياً / نظير-لنظير (JSON)
        </h2>
        <p className="text-xs text-slate-500">
          صدّر بياناتك كحزمة JSON لمشاركتها مع جهاز آخر أو مستخدم آخر بدون خادم مركزي، أو الصق حزمة واردة لاستيرادها.
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
