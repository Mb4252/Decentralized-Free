'use client';
import { useApp } from '@/lib/context';
import { getPriceStatus } from '@/core/price-engine';

const ITEMS = ['دقيق', 'سكر', 'زيت', 'ذرة'];

export default function PricesPage() {
  const { getFairPrice, prices } = useApp();

  return (
    <div className="mt-4 space-y-4">
      <h1 className="text-xl font-bold">رادار السعر العادل</h1>
      <p className="text-sm text-slate-500">الأسعار محسوبة بالوسيط (Median) ومحدثة تلقائياً.</p>
      
      {ITEMS.map(item => {
        const fair = getFairPrice(item.toLowerCase());
        const reports = prices.filter(p => p.itemId === item.toLowerCase());
        
        return (
          <div key={item} className="card">
            <h2 className="font-bold text-lg mb-2">{item}</h2>
            {fair ? (
              <div className="flex justify-between items-center">
                <span className="text-2xl font-bold text-teal-700">{fair.toFixed(0)} جنيه</span>
                <span className={`text-xs px-2 py-1 rounded ${reports.length > 2 ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                  {reports.length} بلاغ
                </span>
              </div>
            ) : (
              <p className="text-slate-400 text-sm">لا توجد بلاغات كافية لحساب السعر.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
