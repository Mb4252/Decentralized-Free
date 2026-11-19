'use client';

import { useWallet } from '@/lib/context';
import SendForm from '@/components/SendForm';
import Link from 'next/link';

export default function SendPage() {
  const { wallet, loading } = useWallet();
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
    <div className="mt-4">
      <h1 className="text-xl font-bold text-chronos-800 mb-4">تحويل ساعات العطاء</h1>
      <SendForm />
    </div>
  );
}
