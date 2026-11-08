'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from './Toast'

export default function WithdrawModal({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleWithdraw() {
    if (!amount) return toast('أدخل المبلغ', 'error')
    setLoading(true)
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // هنا يتم إرسال طلب سحب (بخصم الرصيد وإضافته في قائمة المعلقة)
    const { error } = await supabase.rpc('admin_add_balance', { 
      target_email: user.email, 
      nils: 0, 
      sdgs: -Number(amount) 
    })

    if (error) toast('حدث خطأ', 'error')
    else {
      toast('تم طلب السحب بنجاح', 'success')
      onClose()
      window.location.reload()
    }
    setLoading(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ backgroundColor: '#181a20', width: '100%', maxWidth: '360px', borderRadius: '8px', border: '1px solid #2b3139', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ color: 'white', margin: 0, fontSize: '18px' }}>سحب الأرباح</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#848e9c', cursor: 'pointer', fontSize: '18px' }}>✕</button>
        </div>
        
        <input type="number" placeholder="المبلغ (SDG)" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#2b3139', color: 'white', border: 'none', borderRadius: '4px', marginBottom: '16px' }} />
        
        <button onClick={handleWithdraw} disabled={loading} style={{ width: '100%', padding: '12px', backgroundColor: '#f6465d', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}>
          {loading ? 'جاري...' : 'طلب سحب'}
        </button>
      </div>
    </div>
  )
}
