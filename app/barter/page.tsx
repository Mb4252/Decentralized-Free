'use client';
import { useApp } from '@/lib/context';
import { findMatches } from '@/core/barter-matcher';

export default function BarterPage() {
  const { barters } = useApp();
  const matches = findMatches(barters);

  return (
    <div className="mt-4 space-y-4">
      <h1 className="text-xl font-bold">سوق المقايضة</h1>
      
      <div className="card bg-teal-50 border-teal-200">
        <h2 className="font-bold text-teal-800 mb-2">🤝 المطابقات الذكية المكتشفة</h2>
        {matches.length === 0 ? (
          <p className="text-sm text-teal-600">لا توجد مطابقات حالياً. أضف عرضك أو طلبك.</p>
        ) : (
          <ul className="space-y-2">
            {matches.map((m, i) => (
              <li key={i} className="text-sm bg-white p-2 rounded shadow-sm">
                <span className="font-bold">{m.type === 'direct' ? 'تبادل مباشر' : 'حلقة دائرية'}: </span>
                {m.path.map(p => p.itemName).join(' ↔ ')}
              </li>
            ))}
          </ul>
        )}
      </div>

      <h2 className="font-bold mt-6 mb-2">كل العروض والطلبات</h2>
      {barters.length === 0 && <p className="text-slate-400 text-sm">لا توجد عروض بعد.</p>}
      {barters.map(b => (
        <div key={b.id} className="card flex justify-between items-center">
          <div>
            <span className={`text-xs px-2 py-0.5 rounded ${b.type === 'offer' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
              {b.type === 'offer' ? 'أملك' : 'أحتاج'}
            </span>
            <h3 className="font-bold mt-1">{b.itemName} ({b.quantity})</h3>
            <p className="text-xs text-slate-500">📍 {b.location}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
