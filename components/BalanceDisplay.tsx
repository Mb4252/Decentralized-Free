'use client';

import { useWallet } from '@/lib/context';

export default function BalanceDisplay() {
  const { balance, wallet } = useWallet();
  if (!wallet) return null;
  return (
    <div className="card text-center">
      <p className="text-sm text-slate-500 mb-1">رصيدك من ساعات العطاء</p>
      <p className="text-5xl font-bold text-chronos-700">
        {balance.toFixed(2)}
        <span className="text-lg font-normal mr-2">ساعة</span>
      </p>
      <p className="text-xs text-slate-400 mt-2 font-mono" dir="ltr">
        {wallet.address}
      </p>
    </div>
  );
}
