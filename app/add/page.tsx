'use client';
import { useState } from 'react';
import { useApp } from '@/lib/context';

export default function AddPage() {
  const { addPrice, addBarter } = useApp();
  const [step, setStep] = useState(1);
  const [type, setType] = useState<'price' | 'offer' | 'need'>('price');
  const [item, setItem] = useState('دقيق');
  const [quantity, setQuantity] = useState('1 كجم');
  const [price, setPrice] = useState('');
  const [location, setLocation] = useState('الخرطوم');
  const [success, setSuccess] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (type === 'price') {
      addPrice({
        itemId: item.toLowerCase(),
        itemName: item,
        price: Number(price),
        unitRef: 1, // افتراضي
        location
      });
    } else {
      addBarter({
        type: type as 'offer' | 'need',
        userId: 'user-' + Math.floor(Math.random() * 1000),
        itemId: item.toLowerCase(),
        itemName: item,
        quantity,
        location
      });
    }
    setSuccess(true);
    setTimeout(() => {
      setSuccess(false);
      setStep(1);
      setPrice('');
    }, 2000);
  };

  if (success) {
    return (
      <div className="card text-center mt-10">
        <h2 className="text-2xl text-green-600 mb-4">✅ تمت الإضافة بنجاح!</h2>
        <p>شكراً لمساهمتك في مجتمع عادل.</p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <h1 className="text-xl font-bold mb-4">إضافة سريعة</h1>
      
      {step === 1 && (
        <div className="card space-y-4">
          <div>
            <label className="label">ماذا تريد أن تفعل؟</label>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => setType('price')} className={`p-2 rounded border ${type === 'price' ? 'bg-teal-100 border-teal-500' : ''}`}>بلاغ سعر</button>
              <button onClick={() => setType('offer')} className={`p-2 rounded border ${type === 'offer' ? 'bg-teal-100 border-teal-500' : ''}`}>أملك (عرض)</button>
              <button onClick={() => setType('need')} className={`p-2 rounded border ${type === 'need' ? 'bg-teal-100 border-teal-500' : ''}`}>أحتاج (طلب)</button>
            </div>
          </div>
          <div>
            <label className="label">السلعة</label>
            <input className="input-field" value={item} onChange={e => setItem(e.target.value)} placeholder="دقيق، سكر، زيت..." />
          </div>
          <button onClick={() => setStep(2)} className="btn-primary w-full">التالي</button>
        </div>
      )}

      {step === 2 && (
        <form onSubmit={handleSubmit} className="card space-y-4">
          {type === 'price' ? (
            <div>
              <label className="label">السعر (بالجنيه السوداني)</label>
              <input type="number" className="input-field" value={price} onChange={e => setPrice(e.target.value)} required />
            </div>
          ) : (
            <div>
              <label className="label">الكمية</label>
              <input className="input-field" value={quantity} onChange={e => setQuantity(e.target.value)} required />
            </div>
          )}
          <div>
            <label className="label">الحي / المنطقة</label>
            <input className="input-field" value={location} onChange={e => setLocation(e.target.value)} required />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(1)} className="btn-secondary w-1/3">رجوع</button>
            <button type="submit" className="btn-primary w-2/3">حفظ فوري</button>
          </div>
        </form>
      )}
    </div>
  );
}
