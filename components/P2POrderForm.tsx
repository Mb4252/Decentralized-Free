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

    if (numPrice <= 0 || numAmount <= 0) return toast('أدخل سعر وكمية', 'error')
    if (side === 'buy' && (numPrice * numAmount) > profile.sdg_balance) return toast('رصيد SDG غير كافٍ', 'error')
    if (side === 'sell' && numAmount > profile.nil_balance) return toast('رصيد NIL غير كافٍ', 'error')

    setSubmitting(true)
    try {
      const { error } = await supabase.from('orders').insert({ user_id: userId, side, price: numPrice, amount: numAmount, status: 'open' })
      if (error) throw error
      toast('تم الإرسال', 'success')
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex bg-[#2b3139] rounded p-0.5">
        <button type="button" onClick={() => setSide('buy')} className={`flex-1 py-1 text-[10px] font-bold rounded ${isBuy ? 'bg-[#0ecb81] text-black' : 'text-[#848e9c]'}`}>شراء</button>
        <button type="button" onClick={() => setSide('sell')} className={`flex-1 py-1 text-[10px] font-bold rounded ${!isBuy ? 'bg-[#f6465d] text-white' : 'text-[#848e9c]'}`}>بيع</button>
      </div>

      <div>
        <div className="text-[9px] text-[#848e9c] mb-0.5">السعر (SDG)</div>
        {/* تم إجبار الخلفية الداكنة للحقل */}
        <input type="number" required value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" className="w-full bg-[#2b3139] text-white border-none rounded px-2 py-1 text-[11px] outline-none text-right font-mono" />
      </div>

      <div>
        <div className="flex justify-between text-[9px] text-[#848e9c] mb-0.5">
          <span>الكمية (NIL)</span>
          <span>متاح: {formatNumber(isBuy ? profile?.sdg_balance : profile?.nil_balance, 0)}</span>
        </div>
        <input type="number" required value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="w-full bg-[#2b3139] text-white border-none rounded px-2 py-1 text-[11px] outline-none text-right font-mono" />
      </div>

      <input type="range" min="0" max="100" step="25" onChange={(e) => handlePercentage(Number(e.target.value))} className="w-full h-1 bg-[#2b3139] rounded appearance-none cursor-pointer accent-[#0ecb81]" />

      <div className="flex justify-between text-[9px] text-[#848e9c]">
        <span>الإجمالي</span>
        <span className="text-white font-mono">{formatNumber(Number(price) * Number(amount), 0)}</span>
      </div>

      <button type="submit" disabled={submitting} className={`w-full py-1.5 rounded font-bold text-black text-[11px] ${isBuy ? 'bg-[#0ecb81]' : 'bg-[#f6465d] text-white'}`}>
        {submitting ? '...' : isBuy ? 'شراء NIL' : 'بيع NIL'}
      </button>
    </form>
  )
}
