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
      setBids(orders.filter(o => o.side === 'buy').sort((a, b) => b.price - a.price).slice(0, 6))
      setAsks(orders.filter(o => o.side === 'sell').sort((a, b) => a.price - b.price).slice(0, 6))
    }
  }

  useEffect(() => {
    loadData()
    const ch = supabase.channel('ob').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, loadData).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const maxAmount = Math.max(...bids.map(b => b.amount), ...asks.map(a => a.amount), 1)

  return (
    // إجبار الاتجاه LTR لضمان عدم تداخل الأرقام
    <div className="flex flex-col h-full text-[10px] font-mono w-full" dir="ltr">
      
      {/* العناوين */}
      <div className="flex justify-between text-[#848e9c] px-2 py-1 border-b border-[#2b3139]">
        <span className="w-1/2 text-left">Price(SDG)</span>
        <span className="w-1/2 text-right">Amt(NIL)</span>
      </div>

      {/* المبيعات (Asks) */}
      <div className="flex flex-col-reverse flex-1">
        {asks.map((a, i) => (
          <div key={i} className="relative flex justify-between py-0.5 px-2">
            <div className="absolute inset-y-0 right-0 bg-[#f6465d]/15" style={{ width: `${(a.amount / maxAmount) * 100}%` }} />
            <span className="text-[#f6465d] z-10 w-1/2 text-left">{formatNumber(a.price, 1)}</span>
            <span className="text-white z-10 w-1/2 text-right">{formatNumber(a.amount, 1)}</span>
          </div>
        ))}
      </div>

      {/* السعر الحالي */}
      <div className="text-sm font-bold text-[#0ecb81] py-1 border-y border-[#2b3139] text-center my-1 bg-[#0b0e11]">
        {formatNumber(asks[0]?.price || bids[0]?.price || 0, 1)}
      </div>

      {/* المشتريات (Bids) */}
      <div className="flex flex-col flex-1">
        {bids.map((b, i) => (
          <div key={i} className="relative flex justify-between py-0.5 px-2">
            <div className="absolute inset-y-0 right-0 bg-[#0ecb81]/15" style={{ width: `${(b.amount / maxAmount) * 100}%` }} />
            <span className="text-[#0ecb81] z-10 w-1/2 text-left">{formatNumber(b.price, 1)}</span>
            <span className="text-white z-10 w-1/2 text-right">{formatNumber(b.amount, 1)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
