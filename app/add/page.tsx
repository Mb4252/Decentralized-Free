'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/context';

const QUICK_ITEMS_BY_KIND: Record<'price' | 'have' | 'need', string[]> = {
  price: ['دقيق', 'سكر', 'زيت طعام', 'أرز', 'عدس', 'ذرة', 'صابون', 'شاي'],
  have: ['دقيق', 'سكر', 'زيت طعام', 'هاتف', 'أدوات كهربائية', 'بطارية شمسية'],
  need: ['دقيق', 'سكر', 'زيت طعام', 'أرز', 'هاتف', 'مقابل نقدي / فرق'],
};

const QUICK_CATEGORIES = ['بقالة', 'محاصيل', 'هواتف', 'أدوات كهربائية', 'مغالق', 'عام'];

const SAVED_ZONES_KEY = 'fair_radar_verified_zones_v1';

function saveZoneLocally(zone: string) {
  const cleaned = zone.trim();
  if (!cleaned) return;
  try {
    const raw = localStorage.getItem(SAVED_ZONES_KEY);
    const list: Array<{ name: string; verifiedVia: string; verifiedAt: number }> = raw
      ? JSON.parse(raw)
      : [];
    if (!Array.isArray(list)) return;
    if (!list.some((z) => z.name.toLowerCase() === cleaned.toLowerCase())) {
      list.unshift({ name: cleaned, verifiedVia: 'manual', verifiedAt: Date.now() });
      localStorage.setItem(SAVED_ZONES_KEY, JSON.stringify(list));
    }
  } catch {
    // تجاهل أخطاء التخزين المحلي
  }
}

export default function AddEntryPage() {
  const router = useRouter();
  const { entries, activeZone, addEntry, exportJsonBundle, importJsonBundle } = useApp();

  const [kind, setKind] = useState<'price' | 'have' | 'need'>('price');
  const [category, setCategory] = useState<string>('بقالة');
  const [item, setItem] = useState<string>('');
  const [price, setPrice] = useState<string>('');
  const [wantItem, setWantItem] = useState<string>('');
  const [location, setLocation] = useState<string>(activeZone || '');
  const [placeName, setPlaceName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [jsonBundle, setJsonBundle] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<string>('');

  const knownZones = useMemo(() => {
    const set = new Set<string>();
    if (activeZone && activeZone.trim()) set.add(activeZone.trim());
    try {
      const raw = localStorage.getItem(SAVED_ZONES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Array<{ name?: string }>;
        if (Array.isArray(parsed)) {
          parsed.forEach((z) => {
            if (z?.name && z.name.trim()) set.add(z.name.trim());
          });
        }
      }
    } catch {
      // تجاهل
    }
    entries.forEach((e) => {
      if (e.location && e.location.trim()) set.add(e.location.trim());
    });
    return Array.from(set);
  }, [entries, activeZone]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalItem = item.trim();
    const finalLocation = (location.trim() || activeZone || 'عام').trim();
    if (!finalItem) {
      setStatusMsg('يرجى اختيار سلعة من الخيارات أو كتابة اسم الشيء المطلوب/المتوفر.');
      return;
    }

    const numericPrice = kind === 'price' && price.trim() ? Number(price.replace(/[^\d.]/g, '')) : undefined;
    const composedNote = phone.trim()
      ? `${note.trim() ? `${note.trim()} | ` : ''}تواصل: ${phone.trim()}`
      : note.trim();

    saveZoneLocally(finalLocation);

    const payload = {
      kind,
      category: category.trim() || 'عام',
      item: finalItem,
      price: typeof numericPrice === 'number' && Number.isFinite(numericPrice) ? numericPrice : undefined,
      wantItem: kind !== 'price' ? wantItem.trim() || undefined : undefined,
      location: finalLocation,
      placeName: placeName.trim() || undefined,
      note: composedNote || undefined,
      phone: phone.trim() || undefined,
    };

    addEntry(payload as unknown as Parameters<typeof addEntry>[0]);
    setStatusMsg(`تم حفظ «${finalItem}» في منطقتك (${finalLocation}) بنجاح.`);
    setItem('');
    setPrice('');
    setWantItem('');
    setNote('');
    setTimeout(() => {
      router.push('/');
    }, 600);
  };

  const handleExport = () => {
    const data = exportJsonBundle();
    setJsonBundle(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    setStatusMsg('تم تصدير حزمة البيانات JSON.');
  };

  const handleImport = () => {
    if (!jsonBundle.trim()) return;
    importJsonBundle(jsonBundle);
    setStatusMsg('تم استيراد ومزامنة حزمة البيانات بنجاح.');
  };

  return (
    <main dir="rtl" className="mx-auto max-w-2xl space-y-4 p-4 text-slate-100">
      <section className="space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-4">
        <h1 className="text-lg font-bold text-white">إضافة بلاغ سعر أو عرض / طلب مقايضة</h1>

        {/* نوع المنشور */}
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setKind('price')}
            className={`rounded-lg py-2 text-xs font-bold ${
              kind === 'price' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            🏷️ بلاغ سعر
          </button>
          <button
            type="button"
            onClick={() => setKind('have')}
            className={`rounded-lg py-2 text-xs font-bold ${
              kind === 'have' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            🟢 أملك (عرض)
          </button>
          <button
            type="button"
            onClick={() => setKind('need')}
            className={`rounded-lg py-2 text-xs font-bold ${
              kind === 'need' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'
            }`}
          >
            🔵 أحتاج (طلب)
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          {/* المنطقة المحفوظة أو الجديدة */}
          <div>
            <label className="mb-1 block font-bold text-emerald-300">المنطقة / الحي (يُحفظ تلقائياً)</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="مثال: ود مدني، محلية ام القرى..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-emerald-400 focus:outline-none"
            />
            {knownZones.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {knownZones.map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => setLocation(z)}
                    className={`rounded-md px-2.5 py-1 text-[11px] ${
                      location === z
                        ? 'bg-emerald-600 font-bold text-white'
                        : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    📍 {z}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* التصنيف */}
          <div>
            <label className="mb-1 block font-bold text-slate-200">القسم / التصنيف</label>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`rounded-md px-2.5 py-1 text-[11px] ${
                    category === cat
                      ? 'bg-emerald-600 font-bold text-white'
                      : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* خيارات سريعة + كتابة أي شيء يريده الشخص في الأسفل */}
          <div>
            <label className="mb-1 block font-bold text-emerald-300">
              اختر من الخيارات السريعة أو اكتب ما تريد بالأسفل
            </label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {QUICK_ITEMS_BY_KIND[kind].map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setItem(opt)}
                  className={`rounded-md border px-2.5 py-1 text-[11px] transition ${
                    item === opt
                      ? 'border-emerald-400 bg-emerald-950 font-bold text-emerald-200'
                      : 'border-slate-700 bg-slate-950 text-slate-200 hover:border-slate-500'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={item}
              onChange={(e) => setItem(e.target.value)}
              placeholder="اكتب هنا أي سلعة أو غرض أو خدمة تريدها (مثال: شوال سكر، دقيق، هاتف، أو أي شيء آخر)..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white placeholder-slate-400 focus:border-emerald-400 focus:outline-none"
            />
          </div>

          {kind === 'price' ? (
            <div>
              <label className="mb-1 block font-bold text-slate-200">السعر</label>
              <input
                type="text"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="مثال: 230000"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-emerald-400 focus:outline-none"
              />
            </div>
          ) : (
            <div>
              <label className="mb-1 block font-bold text-slate-200">
                {kind === 'have' ? 'المقابل الذي تطلبه أو تقبله (اختياري)' : 'ما الذي تقدمه مقابل حاجتك (اختياري)'}
              </label>
              <input
                type="text"
                value={wantItem}
                onChange={(e) => setWantItem(e.target.value)}
                placeholder="مثال: سكر، نقد، أو هاتف أحدث مع فرق..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-emerald-400 focus:outline-none"
              />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block font-bold text-slate-200">
                اسم المركز / المتجر أو الجهة (اختياري)
              </label>
              <input
                type="text"
                value={placeName}
                onChange={(e) => setPlaceName(e.target.value)}
                placeholder="مثال: بقالة السوق، الجميع، شخصي..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-emerald-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block font-bold text-slate-200">رقم الهاتف / واتساب (اختياري)</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="مثال: +249..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-emerald-400 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block font-bold text-slate-200">ملاحظة إضافية (اختياري)</label>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="أي تفاصيل عن الحالة أو الكمية أو التوفر..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white focus:border-emerald-400 focus:outline-none"
            />
          </div>

          {statusMsg && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/70 px-3 py-2 text-emerald-200">
              {statusMsg}
            </div>
          )}

          <button
            type="submit"
            className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white hover:bg-emerald-500"
          >
            نشر وحفظ في المنصة
          </button>
        </form>
      </section>

      {/* مزامنة JSON */}
      <section className="space-y-2.5 rounded-xl border border-slate-700 bg-slate-900 p-4 text-xs">
        <h2 className="text-sm font-bold text-white">مزامنة حزم البيانات (JSON)</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="rounded-lg bg-slate-800 px-3 py-1.5 font-semibold text-white hover:bg-slate-700"
          >
            تصدير JSON
          </button>
          <button
            type="button"
            onClick={handleImport}
            className="rounded-lg bg-sky-700 px-3 py-1.5 font-semibold text-white hover:bg-sky-600"
          >
            استيراد JSON
          </button>
        </div>
        <textarea
          rows={3}
          value={jsonBundle}
          onChange={(e) => setJsonBundle(e.target.value)}
          placeholder="الصق حزمة JSON هنا للاستيراد أو اضغط تصدير..."
          className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-slate-200 focus:border-emerald-400 focus:outline-none"
        />
      </section>
    </main>
  );
}
