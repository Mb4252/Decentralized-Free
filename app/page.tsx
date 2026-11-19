'use client';

import Link from 'next/link';
import { useApp } from '@/lib/context';

export default function HomePage() {
  const { priceReports, barterOffers, matches, localPeer } = useApp();

  return (
    <div className="mt-4 space-y-5 pb-24">
      <div className="card space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold text-slate-900">
            رادار السعر العادل والمقايضة الذكية
          </h1>
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">
          مؤشر أسعار مجتمعي بالوسيط الحسابي (Median) مع كشف الأسعار الشاذة وسوق مقايضة مباشر يوضح الأطراف والتواصل.
        </p>
        <div className="text-xs text-slate-500 pt-1">
          هويتك المحلية: <strong>{localPeer.defaultName}</strong> ({localPeer.peerId})
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/prices" className="card hover:border-teal-500 transition">
          <div className="text-xs text-slate-500">بلاغات الأسعار</div>
          <div className="text-2xl font-bold text-teal-700 mt-1">{priceReports.length}</div>
          <div className="text-xs text-teal-600 mt-2">فتح الرادار ←</div>
        </Link>

        <Link href="/barter" className="card hover:border-teal-500 transition">
          <div className="text-xs text-slate-500">عروض وطلبات المقايضة</div>
          <div className="text-2xl font-bold text-teal-700 mt-1">{barterOffers.length}</div>
          <div className="text-xs text-teal-600 mt-2">سوق المقايضة ←</div>
        </Link>
      </div>

      <Link href="/barter" className="card block hover:border-teal-500 transition">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500">المطابقات الذكية الجاهزة</div>
            <div className="text-lg font-bold text-slate-900 mt-0.5">
              {matches.length} مطابقة مكتشفة
            </div>
          </div>
          <span className="text-xs font-semibold text-teal-700">عرض التفاصيل ←</span>
        </div>
      </Link>

      <Link href="/add" className="btn-primary block w-full py-3 text-center">
        ➕ إضافة بلاغ سعر أو عرض مقايضة
      </Link>
    </div>
  );
}
