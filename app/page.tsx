'use client';

import Link from 'next/link';
import { useWallet } from '@/lib/context';
import BalanceDisplay from '@/components/BalanceDisplay';

export default function HomePage() {
  const { wallet, loading, createNewWallet } = useWallet();

  if (loading)
    return <p className="text-center py-12 text-slate-500">جارٍ التحميل...</p>;

  if (!wallet) {
    return (
      <div className="space-y-6 mt-8">
        <div className="card text-center space-y-4">
          <h1 className="text-2xl font-bold text-chronos-800">
            مرحباً بك في نظام الجدارة الزمنية
          </h1>
          <p className="text-slate-600 leading-relaxed">
            نظام مالي لامركزي يعتمد على <strong>ساعة العطاء البشري</strong> كوحدة تبادل.
            لا بنوك، لا ربا، لا احتكار. محفظتك وسجلك على جهازك فقط.
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <Link href="/wallet" className="btn-primary">
              إنشاء محفظة جديدة
            </Link>
            <Link href="/wallet" className="btn-secondary">
              استعادة محفظة
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card">
            <h3 className="font-bold text-chronos-700 mb-2">⏳ ساعة العطاء</h3>
            <p className="text-sm text-slate-600">
              كل خدمة تُقاس بالوقت والجهد البشري، لا بالتعدين الاستهلاكي.
            </p>
          </div>
          <div className="card">
            <h3 className="font-bold text-chronos-700 mb-2">🔄 ديناميكية الرصيد</h3>
            <p className="text-sm text-slate-600">
              الأرصدة المعطلة تتراجع 0.5% شهرياً لتدوير الثروة ومنع الاحتكار.
            </p>
          </div>
          <div className="card">
            <h3 className="font-bold text-chronos-700 mb-2">🚫 خلو من الربا</h3>
            <p className="text-sm text-slate-600">
              لا فوائد مركبة، لا رسوم تحويل. تبادل عادل عن تراضٍ.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 mt-4">
      <BalanceDisplay />
      <div className="grid grid-cols-2 gap-3">
        <Link href="/send" className="btn-primary text-center">
          تحويل ساعات
        </Link>
        <Link href="/services" className="btn-secondary text-center">
          إضافة خدمة
        </Link>
      </div>
    </div>
  );
}
