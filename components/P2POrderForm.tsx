'use client'
import { useState, useEffect } from 'react'
import { supabase, getUserProfile } from '@/lib/supabase'
import { toast } from './Toast'
import { formatNumber } from '@/lib/utils'

export default function P2POrderForm({ userId }: { userId: string }) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [price, setPrice] = useState('')
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [profile, setProfile] = useState<any>(null)

  useEffect(() => { getUserProfile().then(setProfile) }, [])

  const handlePercentage = (pct: number) => {
    if (!profile) return
    if (side === 'buy') {
      const maxNIL = (profile.sdg_balance * pct) / (Number(price) || 1)
      setAmount(maxNIL.toFixed(2))
    } else {
      const maxNIL = (profile.nil_balance * pct) / 100
      setAmount(maxNIL.toFixed(2))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return
    const numPrice = Number(price)
    const numAmount = Number(amount)
    const total = numPrice * numAmount

    if (numPrice <= 0 || numAmount <= 0) return toast('يجب إدخال سعر وكمية صحيحة', 'error')
    if (side === 'buy' && total > profile.sdg_balance) return toast('رصيد SDG غير كافٍ', 'error')
    if (side === 'sell' && numAmount > profile.nil_balance) return toast('رصيد NIL غير كافٍ', 'error')

    setSubmitting(true)
    try {
      const { error } = await supabase.from('orders').insert({
        user_id: userId, side, price: numPrice, amount: numAmount, status: 'open'
      })
      if (error) throw error
      toast('تم إرسال الطلب', 'success')
      setPrice(''); setAmount('')
      getUserProfile().then(setProfile)
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const isBuy = side === 'buy'

  return (
    <form onSubmit={handleSubmit} className="space-y-2 md:space-y-3">
      {/* أزرار التبديل */}
      <div className="flex bg-[#2b3139] rounded p-1">
        <button type="button" onClick={() => setSide('buy')} className={`flex-1 py-1.5 text-xs md:text-sm font-bold rounded ${isBuy ? 'bg-[#0ecb81] text-black' : 'text-[#848e9c]'}`}>شراء</button>
        <button type="button" onClick={() => setSide('sell')} className={`flex-1 py-1.5 text-xs md:text-sm font-bold rounded ${!isBuy ? 'bg-[#f6465d] text-white' : 'text-[#848e9c]'}`}>بيع</button>
      </div>

      {/* السعر */}
      <div>
        <div className="flex justify-between text-[10px] text-[#848e9c] mb-1">
          <span>السعر (SDG)</span>
        </div>
        <div className="flex bg-[#2b3139] rounded items-center px-2 py-1.5">
          <input type="number" required value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" className="bg-transparent text-white w-full outline-none text-right font-mono text-xs" />
        </div>
      </div>

      {/* الكمية */}
      <div>
        <div className="flex justify-between text-[10px] text-[#848e9c] mb-1">
          <span>الكمية (NIL)</span>
          <span>متاح: {formatNumber(isBuy ? profile?.sdg_balance : profile?.nil_balance, 0)}</span>
        </div>
        <div className="flex bg-[#2b3139] rounded items-center px-2 py-1.5">
          <input type="number" required value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="bg-transparent text-white w-full outline-none text-right font-mono text-xs" />
        </div>
      </div>

      {/* شريط التمرير */}
      <div className="pt-1">
        <input type="range" min="0" max="100" step="25" onChange={(e) => handlePercentage(Number(e.target.value))} className="w-full h-1 bg-[#2b3139] rounded appearance-none cursor-pointer accent-[#0ecb81]" />
        <div className="flex justify-between text-[8px] text-[#848e9c] mt-1">
          <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
        </div>
      </div>

      {/* الإجمالي */}
      <div className="flex justify-between text-[10px] pt-1 border-t border-[#2b3139]">
        <span className="text-[#848e9c]">الإجمالي (SDG)</span>
        <span className="text-white font-bold font-mono">{formatNumber(Number(price) * Number(amount))}</span>
      </div>

      {/* زر الإرسال */}
      <button type="submit" disabled={submitting} className={`w-full py-2 rounded font-bold text-black text-xs md:text-sm transition ${isBuy ? 'bg-[#0ecb81] hover:bg-[#0ecb81]/90' : 'bg-[#f6465d] hover:bg-[#f6465d]/90'}`}>
        {submitting ? 'جاري التنفيذ...' : isBuy ? 'شراء NIL' : 'بيع NIL'}
      </button>
    </form>
  )
}
