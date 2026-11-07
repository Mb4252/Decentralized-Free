'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatNumber } from '@/lib/utils'

export default function OrderBook() {
  const [bids, setBids] = useState<any[]>([])
  const [asks, setAsks] = useState<any[]>([])

  const loadData = async () => {
    const { data: orders } = await supabase.from('orders').select('id, side, price, amount').eq('status', 'open')
    if (orders) {
      setBids(orders.filter(o => o.side === 'buy').sort((a, b) => b.price - a.price).slice(0, 8))
      setAsks(orders.filter(o => o.side === 'sell').sort((a, b) => a.price - b.price).slice(0, 8))
    }
  }

  useEffect(() => {
    loadData()
    const ch = supabase.channel('ob').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, loadData).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const maxAmount = Math.max(...bids.map(b => b.amount), ...asks.map(a => a.amount), 1)
  const midPrice = asks[0]?.price || bids[0]?.price || 0

  return (
    <div className="flex flex-col h-full text-xs font-mono" dir="ltr">
      {/* شريط المبيعات (Asks) */}
      <div className="flex justify-between text-[10px] text-[#848e9c] mb-1 px-2">
        <span>السعر (SDG)</span>
        <span>الكمية (NIL)</span>
      </div>
      <div className="flex flex-col-reverse mb-2">
        {asks.map((a, i) => (
          <div key={i} className="relative flex justify-between py-1 px-2 hover:bg-[#2b3139]">
            <div className="absolute inset-y-0 right-0 bg-[#f6465d]/15" style={{ width: `${(a.amount / maxAmount) * 100}%` }} />
            <span className="text-[#f6465d] z-10">{formatNumber(a.price)}</span>
            <span className="text-white z-10">{formatNumber(a.amount)}</span>
          </div>
        ))}
      </div>

      {/* السعر الحالي */}
      <div className="text-lg font-bold text-[#0ecb81] py-2 border-y border-[#2b3139] text-center my-1 bg-[#0b0e11]">
        {formatNumber(midPrice)}
      </div>

      {/* شريط المشتريات (Bids) */}
      <div>
        {bids.map((b, i) => (
          <div key={i} className="relative flex justify-between py-1 px-2 hover:bg-[#2b3139]">
            <div className="absolute inset-y-0 right-0 bg-[#0ecb81]/15" style={{ width: `${(b.amount / maxAmount) * 100}%` }} />
            <span className="text-[#0ecb81] z-10">{formatNumber(b.price)}</span>
            <span className="text-white z-10">{formatNumber(b.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
