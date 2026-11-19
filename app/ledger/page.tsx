'use client';

import { useWallet } from '@/lib/context';
import LedgerView from '@/components/LedgerView';
import Link from 'next/link';

export default function LedgerPage() {
  const { wallet, ledger, loading } = useWallet();
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
      <h1 className="text-xl font-bold text-chronos-800 mb-2">السجل المحلي</h1>
      <p className="text-sm text-slate-500 mb-4">
        كل معاملة موقعة ومشفرة ومحفوظة على جهازك فقط. عدد القيود: {ledger.length}
      </p>
      <LedgerView />
    </div>
  );
}
