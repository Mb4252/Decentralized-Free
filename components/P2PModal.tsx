'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from './Toast'

export default function P2PModal({ onClose }: { onClose: () => void }) {
  const [side, setSide] = useState<'buy'|'sell'>('buy')
  const [price, setPrice] = useState('')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCreateAd() {
    if (!price || !amount) return toast('أدخل السعر والكمية', 'error')
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error } = await supabase.from('orders').insert({
      user_id: user.id, side, price: Number(price), amount: Number(amount), status: 'open'
    })

    if (error) toast(error.message, 'error')
    else {
      toast('تم إضافة الإعلان بنجاح', 'success')
      onClose()
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-[#181a20] w-full max-w-sm rounded-lg border border-[#2b3139] p-5">
        <h2 className="text-white text-lg font-bold mb-4">إعلان P2P جديد</h2>
        <div className="flex gap-2 mb-4">
           <button onClick={() => setSide('buy')} className={`flex-1 py-2 rounded text-sm font-bold ${side === 'buy' ? 'bg-[#0ecb81] text-black' : 'bg-[#2b3139] text-white'}`}>شراء</button>
           <button onClick={() => setSide('sell')} className={`flex-1 py-2 rounded text-sm font-bold ${side === 'sell' ? 'bg-[#f6465d] text-white' : 'bg-[#2b3139] text-white'}`}>بيع</button>
        </div>
        <input type="number" placeholder="السعر (SDG)" value={price} onChange={e => setPrice(e.target.value)} className="w-full bg-[#2b3139] text-white rounded px-3 py-2 mb-3 text-sm" />
        <input type="number" placeholder="الكمية (NIL)" value={amount} onChange={e => setAmount(e.target.value)} className="w-full bg-[#2b3139] text-white rounded px-3 py-2 mb-4 text-sm" />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 bg-[#2b3139] text-white py-2 rounded text-sm">إلغاء</button>
          <button onClick={handleCreateAd} disabled={loading} className="flex-1 bg-[#f3ba2f] text-black font-bold py-2 rounded text-sm">{loading ? '...' : 'نشر الإعلان'}</button>
        </div>
      </div>
    </div>
  )
}
