'use client';

import { useState } from 'react';
import { useWallet } from '@/lib/context';

export default function SendForm() {
  const { sendHours, balance } = useWallet();
  const [to, setTo] = useState('');
  const [hours, setHours] = useState('');
  const [memo, setMemo] = useState('');
  const [status, setStatus] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    setBusy(true);
    try {
      const h = parseFloat(hours);
      if (isNaN(h) || h <= 0) throw new Error('أدخل عدد ساعات صحيحاً');
      if (h > balance) throw new Error('الرصيد غير كافٍ');
      await sendHours(to.trim(), h, memo.trim());
      setStatus({ type: 'ok', msg: 'تم تسجيل المعاملة بنجاح ✅' });
      setTo('');
      setHours('');
      setMemo('');
    } catch (err: any) {
      setStatus({ type: 'err', msg: err.message || 'خطأ غير متوقع' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <div>
        <label className="label">عنوان المستقبل (CHR-...)</label>
        <input
          className="input-field font-mono"
          dir="ltr"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="CHR-XXXXXXXXXXXX"
          required
        />
      </div>
      <div>
        <label className="label">عدد الساعات</label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          className="input-field"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          placeholder="0.00"
          required
        />
        <p className="text-xs text-slate-400 mt-1">
          المتاح: {balance.toFixed(2)} ساعة
        </p>
      </div>
      <div>
        <label className="label">وصف العطاء</label>
        <input
          className="input-field"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="مثال: إصلاح حاسوب، تعليم رياضيات..."
        />
      </div>
      {status && (
        <div
          className={`p-3 rounded-xl text-sm ${
            status.type === 'ok'
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800'
          }`}
        >
          {status.msg}
        </div>
      )}
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? 'جارٍ التحويل...' : 'تحويل الساعات'}
      </button>
    </form>
  );
}
