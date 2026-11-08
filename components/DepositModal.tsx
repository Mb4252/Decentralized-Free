'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from './Toast'

export default function DepositModal({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState('')
  const [ref, setRef] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleDeposit() {
    if (!amount || !ref) return toast('أدخل المبلغ ورقم العملية', 'error')
    setLoading(true)
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error } = await supabase.from('deposits').insert({
      user_id: user.id,
      amount: Number(amount),
      receipt_ref: ref,
      status: 'pending'
    })

    if (error) {
      toast(error.message, 'error')
    } else {
      toast('تم إرسال الطلب، بانتظار موافقة الأدمن', 'success')
      onClose()
    }
    setLoading(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ backgroundColor: '#181a20', width: '100%', maxWidth: '360px', borderRadius: '8px', border: '1px solid #2b3139', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ color: 'white', margin: 0, fontSize: '18px' }}>إيداع</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#848e9c', cursor: 'pointer', fontSize: '18px' }}>✕</button>
        </div>
        
        <p style={{ color: '#848e9c', fontSize: '12px', marginBottom: '16px' }}>
          حول المبلغ إلى حساب بنكك: <strong style={{ color: 'white' }}>1234567890</strong>
        </p>

        <input type="number" placeholder="المبلغ (SDG)" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#2b3139', color: 'white', border: 'none', borderRadius: '4px', marginBottom: '10px' }} />
        <input type="text" placeholder="رقم عملية بنكك" value={ref} onChange={(e) => setRef(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#2b3139', color: 'white', border: 'none', borderRadius: '4px', marginBottom: '16px' }} />
        
        <button onClick={handleDeposit} disabled={loading} style={{ width: '100%', padding: '12px', backgroundColor: '#0ecb81', color: 'black', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}>
          {loading ? 'جاري...' : 'تأكيد الإيداع'}
        </button>
      </div>
    </div>
  )
}
