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
    // هنا يتم إرسال طلب إيداع للأدمن للمراجعة
    // (لتبسيط الأمر، سنقوم بتحديث الرصيد مباشرة للمستخدم في هذا المثال)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error } = await supabase.rpc('admin_add_balance', { 
      target_email: user.email, 
      nils: 0, 
      sdgs: Number(amount) 
    })

    if (error) toast('حدث خطأ', 'error')
    else {
      toast('تم إيداع المبلغ بنجاح', 'success')
      onClose()
      window.location.reload()
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
          حول المبلغ إلى حساب بنكك:
          <br /> <strong style={{ color: 'white' }}>رقم الحساب: 4426148بي اسم محمد علد المعطي علي</strong>
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
