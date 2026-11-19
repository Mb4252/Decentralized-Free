'use client';

import { useWallet } from '@/lib/context';
import ServiceForm from '@/components/ServiceForm';
import Link from 'next/link';

export default function ServicesPage() {
  const { wallet, services, loading } = useWallet();
  if (loading) return <p className="text-center py-12 text-slate-500">جارٍ التحميل...</p>;
  if (!wallet)
    return (
      <div className="card text-center mt-8">
        <p className="mb-3">تحتاج إلى إنشاء محفظة أولاً.</p>
        <Link href="/wallet" className="btn-primary inline-block">
          إنشاء محفظة
        </Link>
      </div>
    );

  return (
    <div className="space-y-4 mt-4">
      <h1 className="text-xl font-bold text-chronos-800">سوق الخدمات التعاوني</h1>
      <ServiceForm />
      <div className="space-y-3">
        {services.length === 0 && (
          <p className="text-center text-slate-500 py-4">لا توجد خدمات بعد.</p>
        )}
        {[...services].reverse().map((s) => (
          <div key={s.id} className="card">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-bold text-chronos-800">{s.title}</h3>
                {s.description && (
                  <p className="text-sm text-slate-600 mt-1">{s.description}</p>
                )}
                <p className="text-xs text-slate-400 font-mono mt-2" dir="ltr">
                  {s.owner}
                </p>
              </div>
              <span className="bg-chronos-100 text-chronos-800 text-sm font-bold px-3 py-1 rounded-lg whitespace-nowrap">
                {s.hours} ساعة
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
