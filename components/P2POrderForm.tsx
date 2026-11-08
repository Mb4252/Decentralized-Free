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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return
    const numPrice = Number(price)
    const numAmount = Number(amount)

    if (numPrice <= 0 || numAmount <= 0) return toast('أدخل سعر وكمية صحيحة', 'error')
    
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
    // تنسيق الحاوية الداكنة
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      {/* أزرار التبديل */}
      <div className="flex bg-[#2b3139] rounded p-0.5">
        <button type="button" onClick={() => setSide('buy')} className={`flex-1 py-1.5 text-xs font-bold rounded ${isBuy ? 'bg-[#0ecb81] text-black' : 'text-[#848e9c]'}`}>شراء</button>
        <button type="button" onClick={() => setSide('sell')} className={`flex-1 py-1.5 text-xs font-bold rounded ${!isBuy ? 'bg-[#f6465d] text-white' : 'text-[#848e9c]'}`}>بيع</button>
      </div>

      {/* السعر */}
      <div>
        <div className="text-[10px] text-[#848e9c] mb-1">السعر (SDG)</div>
        <input 
          type="number" required value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" 
          className="w-full !bg-[#2b3139] !text-white !border-[#2b3139] rounded px-2 py-1.5 text-xs outline-none text-right font-mono focus:border-[#0ecb81]" 
        />
      </div>

      {/* الكمية */}
      <div>
        <div className="flex justify-between text-[10px] text-[#848e9c] mb-1">
          <span>الكمية (NIL)</span>
          <span>متاح: {formatNumber(isBuy ? profile?.nil_balance : profile?.sdg_balance, 0)}</span>
        </div>
        <input 
          type="number" required value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" 
          className="w-full !bg-[#2b3139] !text-white !border-[#2b3139] rounded px-2 py-1.5 text-xs outline-none text-right font-mono focus:border-[#0ecb81]" 
        />
      </div>

      {/* الإجمالي */}
      <div className="flex justify-between text-[10px] mt-1">
        <span className="text-[#848e9c]">الإجمالي (SDG)</span>
        <span className="text-white font-bold font-mono">{formatNumber(Number(price) * Number(amount), 0)}</span>
      </div>

      {/* زر الإرسال */}
      <button type="submit" disabled={submitting} className={`w-full py-2 mt-2 rounded font-bold text-black text-xs transition ${isBuy ? 'bg-[#0ecb81]' : 'bg-[#f6465d]'}`}>
        {submitting ? '...' : isBuy ? 'شراء NIL' : 'بيع NIL'}
      </button>
    </form>
  )
}
