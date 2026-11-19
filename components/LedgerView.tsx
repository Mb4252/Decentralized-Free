'use client';

import { useWallet } from '@/lib/context';

export default function LedgerView() {
  const { ledger, wallet } = useWallet();
  if (!wallet) return null;
  if (ledger.length === 0)
    return <p className="text-center text-slate-500 py-8">السجل فارغ بعد.</p>;

  return (
    <div className="space-y-3">
      {[...ledger].reverse().map((entry) => {
        const isOut = entry.from === wallet.address;
        const isIn = entry.to === wallet.address;
        return (
          <div key={entry.id} className="card text-sm">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-semibold">
                  {isOut ? '📤 صادر' : isIn ? '📥 وارد' : '↔️ تحويل'}
                </p>
                <p className="text-slate-600 mt-1">{entry.memo}</p>
                <p className="text-xs text-slate-400 font-mono mt-1" dir="ltr">
                  {entry.from.slice(0, 12)}… → {entry.to.slice(0, 12)}…
                </p>
              </div>
              <div className="text-left">
                <p className={`font-bold ${isOut ? 'text-red-600' : 'text-green-600'}`}>
                  {isOut ? '-' : isIn ? '+' : ''}
                  {entry.hours.toFixed(2)} ساعة
                </p>
                <p className="text-xs text-slate-400">
                  {new Date(entry.timestamp).toLocaleString('ar')}
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-300 font-mono mt-2 truncate" dir="ltr">
              #{entry.index} · {entry.hash.slice(0, 16)}…
            </p>
          </div>
        );
      })}
    </div>
  );
}
