'use client';

import { useState } from 'react';
import { useWallet } from '@/lib/context';

export default function ServiceForm() {
  const { addService } = useWallet();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [hours, setHours] = useState('');
  const [status, setStatus] = useState('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const h = parseFloat(hours);
    if (!title.trim() || isNaN(h) || h <= 0) return;
    await addService(title.trim(), description.trim(), h);
    setTitle('');
    setDescription('');
    setHours('');
    setStatus('تمت إضافة الخدمة ✅');
    setTimeout(() => setStatus(''), 3000);
  };

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <div>
        <label className="label">اسم الخدمة</label>
        <input
          className="input-field"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="مثال: صيانة كهربائية"
          required
        />
      </div>
      <div>
        <label className="label">الوصف</label>
        <textarea
          className="input-field"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="تفاصيل الخدمة..."
        />
      </div>
      <div>
        <label className="label">عدد الساعات المقدرة</label>
        <input
          type="number"
          step="0.25"
          min="0.25"
          className="input-field"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          required
        />
      </div>
      {status && <p className="text-green-700 text-sm">{status}</p>}
      <button type="submit" className="btn-primary w-full">
        إضافة الخدمة
      </button>
    </form>
  );
}
