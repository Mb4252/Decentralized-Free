'use client'
import { useState, useEffect } from 'react'
import { supabase, getUserProfile } from '@/lib/supabase'
import { toast } from './Toast'
import { formatNumber } from '@/lib/utils'

export default function P2POrderForm({ userId }: { userId: string }) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [price, setPrice] = useState('')
  const [amount, setAmount] = useState('')
  const [paymentRef, setPaymentRef] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [profile, setProfile] = useState<any>(null)

  useEffect(() => { getUserProfile().then(setProfile) }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return

    const numPrice = Number(price)
    const numAmount = Number(amount)
    const total = numPrice * numAmount

    if (side === 'buy' && total > profile.sdg_balance) return toast('رصيد SDG غير كافٍ', 'error')
    if (side === 'sell' && numAmount > profile.nil_balance) return toast('رصيد NIL غير كافٍ', 'error')

    setSubmitting(true)
    try {
      const { error } = await supabase.from('orders').insert({
        user_id: userId, side, price: numPrice, amount: numAmount, payment_ref: paymentRef || null, status: 'open'
      })
      if (error) throw error
      toast('تم إرسال الطلب', 'success')
      setPrice(''); setAmount(''); setPaymentRef('')
      getUserProfile().then(setProfile)
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const isBuy = side === 'buy'

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* أزرار التبديل بين شراء وبيع */}
      <div className="flex bg-[#2b3139] rounded-lg p-1">
        <button type="button" onClick={() => setSide('buy')} className={`flex-1 py-2 text-sm font-bold rounded ${isBuy ? 'bg-[#0ecb81] text-black' : 'text-[#848e9c]'}`}>شراء</button>
        <button type="button" onClick={() => setSide('sell')} className={`flex-1 py-2 text-sm font-bold rounded ${!isBuy ? 'bg-[#f6465d] text-white' : 'text-[#848e9c]'}`}>بيع</button>
      </div>

      {/* السعر */}
      <div>
        <label className="text-xs text-[#848e9c] mb-1 block">السعر (SDG)</label>
        <div className="flex bg-[#2b3139] rounded items-center px-3 py-2">
          <input type="number" required value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" className="bg-transparent text-white w-full outline-none text-right" />
          <span className="text-[#848e9c] text-sm ml-2">SDG</span>
        </div>
      </div>

      {/* الكمية */}
      <div>
        <label className="text-xs text-[#848e9c] mb-1 block">الكمية (NIL)</label>
        <div className="flex bg-[#2b3139] rounded items-center px-3 py-2">
          <input type="number" required value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="bg-transparent text-white w-full outline-none text-right" />
          <span className="text-[#848e9c] text-sm ml-2">NIL</span>
        </div>
      </div>

      {/* الإجمالي */}
      <div className="flex justify-between text-xs text-[#848e9c]">
        <span>الإجمالي:</span>
        <span className="text-white font-bold">{formatNumber(Number(price) * Number(amount))} SDG</span>
      </div>

      {/* المرجع */}
      <input type="text" value={paymentRef} onChange={e => setPaymentRef(e.target.value)} placeholder="رقم عملية بنكك" className="w-full bg-[#2b3139] text-white rounded px-3 py-2 text-sm outline-none" />

      {/* زر الإرسال */}
      <button type="submit" disabled={submitting} className={`w-full py-3 rounded font-bold text-black transition ${isBuy ? 'bg-[#0ecb81] hover:bg-[#0ecb81]/90' : 'bg-[#f6465d] hover:bg-[#f6465d]/90'}`}>
        {submitting ? 'جاري التنفيذ...' : isBuy ? 'شراء NIL' : 'بيع NIL'}
      </button>
    </form>
  )
}
