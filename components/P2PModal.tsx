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

    // يتم إضافة إعلان P2P كطلب في جدول orders
    const { error } = await supabase.from('orders').insert({
      user_id: user.id,
      side,
      price: Number(price),
      amount: Number(amount),
      status: 'open'
    })

    if (error) toast(error.message, 'error')
    else {
      toast('تم إضافة الإعلان بنجاح', 'success')
      onClose()
    }
    setLoading(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ backgroundColor: '#181a20', width: '100%', maxWidth: '360px', borderRadius: '8px', border: '1px solid #2b3139', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ color: 'white', margin: 0, fontSize: '18px' }}>إعلان P2P جديد</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#848e9c', cursor: 'pointer', fontSize: '18px' }}>✕</button>
        </div>
        
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
           <button onClick={() => setSide('buy')} style={{ flex: 1, padding: '8px', backgroundColor: side === 'buy' ? '#0ecb81' : '#2b3139', color: side === 'buy' ? 'black' : 'white', border: 'none', borderRadius: '4px' }}>شراء</button>
           <button onClick={() => setSide('sell')} style={{ flex: 1, padding: '8px', backgroundColor: side === 'sell' ? '#f6465d' : '#2b3139', color: side === 'sell' ? 'white' : 'white', border: 'none', borderRadius: '4px' }}>بيع</button>
        </div>

        <input type="number" placeholder="السعر (SDG)" value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#2b3139', color: 'white', border: 'none', borderRadius: '4px', marginBottom: '10px' }} />
        <input type="number" placeholder="الكمية (NIL)" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#2b3139', color: 'white', border: 'none', borderRadius: '4px', marginBottom: '16px' }} />
        
        <button onClick={handleCreateAd} disabled={loading} style={{ width: '100%', padding: '12px', backgroundColor: '#f3ba2f', color: 'black', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}>
          {loading ? 'جاري...' : 'نشر الإعلان'}
        </button>
      </div>
    </div>
  )
}
