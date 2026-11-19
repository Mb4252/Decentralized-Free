'use client';
import Link from 'next/link';
import { useApp } from '@/lib/context';

export default function HomePage() {
  const { prices, barters } = useApp();

  return (
    <div className="mt-4 space-y-5 pb-20">
      <div className="card space-y-2">
        <h1 className="text-2xl font-bold text-slate-900">
          رادار السعر العادل والمقايضة الذكية
        </h1>
        <p className="text-sm text-slate-600 leading-relaxed">
          مؤشر أسعار مجتمعي بالوسيط الحسابي (Median) وسوق مقايضة سريعة للسلع والخدمات بدون تعقيد.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/prices" className="card hover:border-teal-500 transition">
          <div className="text-xs text-slate-500">بلاغات الأسعار</div>
          <div className="text-2xl font-bold text-teal-700 mt-1">{prices.length}</div>
          <div className="text-xs text-teal-600 mt-2">فتح الرادار ←</div>
        </Link>

        <Link href="/barter" className="card hover:border-teal-500 transition">
          <div className="text-xs text-slate-500">عروض المقايضة</div>
          <div className="text-2xl font-bold text-teal-700 mt-1">{barters.length}</div>
          <div className="text-xs text-teal-600 mt-2">سوق المقايضة ←</div>
        </Link>
      </div>

      <Link href="/add" className="btn-primary block w-full py-3">
        ➕ إضافة بلاغ سعر أو عرض مقايضة
      </Link>
    </div>
  );
}
