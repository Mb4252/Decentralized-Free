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
      user_id: user.id, amount: Number(amount), receipt_ref: ref, status: 'pending'
    })

    if (error) toast(error.message, 'error')
    else {
      toast('تم إرسال الطلب، بانتظار موافقة الأدمن', 'success')
      onClose()
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-[#181a20] w-full max-w-sm rounded-lg border border-[#2b3139] p-5">
        <h2 className="text-white text-lg font-bold mb-4">إيداع (بنكك)</h2>
        <p className="text-[#848e9c] text-xs mb-4">
          حول المبلغ إلى: <strong className="text-white">1234567890</strong> (الاسم: منصة نيل كوين) <br/>ثم أدخل رقم العملية أدناه.
        </p>
        <input type="number" placeholder="المبلغ (SDG)" value={amount} onChange={e => setAmount(e.target.value)} className="w-full bg-[#2b3139] text-white rounded px-3 py-2 mb-3 text-sm" />
        <input type="text" placeholder="رقم عملية بنكك" value={ref} onChange={e => setRef(e.target.value)} className="w-full bg-[#2b3139] text-white rounded px-3 py-2 mb-4 text-sm" />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 bg-[#2b3139] text-white py-2 rounded text-sm">إلغاء</button>
          <button onClick={handleDeposit} disabled={loading} className="flex-1 bg-[#0ecb81] text-black font-bold py-2 rounded text-sm">{loading ? '...' : 'تأكيد'}</button>
        </div>
      </div>
    </div>
  )
}
