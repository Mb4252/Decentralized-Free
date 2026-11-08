'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function WithdrawModal({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState('')
  const [address, setAddress] = useState('')
  const [currency, setCurrency] = useState('SDG')

  const handleWithdraw = async () => {
    // التحقق من الرصيد (نظام أمان)
    alert(`طلب سحب بمبلغ ${amount} ${currency} إلى ${address} قيد المعالجة`)
    onClose()
  }

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ backgroundColor: '#181a20', padding: '20px', borderRadius: '8px', width: '300px', border: '1px solid #2b3139' }}>
        <h2 style={{ color: 'white', marginBottom: '15px', fontSize: '16px' }}>سحب</h2>
        <select value={currency} onChange={e => setCurrency(e.target.value)} style={{ width: '100%', padding: '10px', marginBottom: '10px', backgroundColor: '#2b3139', color: 'white', border: 'none', borderRadius: '4px' }}>
          <option value="SDG">SDG (تحويل بنكي)</option>
          <option value="NIL">NIL (محفظة TON)</option>
        </select>
        <input type="text" placeholder={currency === 'SDG' ? "رقم الحساب البنكي" : "عنوان المحفظة"} value={address} onChange={e => setAddress(e.target.value)} style={{ width: '100%', padding: '10px', marginBottom: '10px', backgroundColor: '#2b3139', color: 'white', border: 'none', borderRadius: '4px' }} />
        <input type="number" placeholder="المبلغ" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: '100%', padding: '10px', marginBottom: '15px', backgroundColor: '#2b3139', color: 'white', border: 'none', borderRadius: '4px' }} />
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={handleWithdraw} style={{ flex: 1, padding: '10px', backgroundColor: '#f6465d', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}>تأكيد السحب</button>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', backgroundColor: '#2b3139', color: 'white', border: 'none', borderRadius: '4px' }}>إلغاء</button>
        </div>
      </div>
    </div>
  )
}
