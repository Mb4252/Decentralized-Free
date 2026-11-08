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

    const { error } = await supabase.from('withdrawals').insert({
      user_id: user.id, amount: Number(amount), status: 'pending'
    })

    if (error) toast(error.message, 'error')
    else {
      toast('تم إرسال طلب السحب، بانتظار الأدمن', 'success')
      onClose()
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-[#181a20] w-full max-w-sm rounded-lg border border-[#2b3139] p-5">
        <h2 className="text-white text-lg font-bold mb-4">سحب الأرباح</h2>
        <input type="number" placeholder="المبلغ (SDG)" value={amount} onChange={e => setAmount(e.target.value)} className="w-full bg-[#2b3139] text-white rounded px-3 py-2 mb-4 text-sm" />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 bg-[#2b3139] text-white py-2 rounded text-sm">إلغاء</button>
          <button onClick={handleWithdraw} disabled={loading} className="flex-1 bg-[#f6465d] text-white font-bold py-2 rounded text-sm">{loading ? '...' : 'طلب سحب'}</button>
        </div>
      </div>
    </div>
  )
}
