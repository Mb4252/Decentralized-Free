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
      // أعلى 6 طلبات شراء
      setBids(orders.filter(o => o.side === 'buy').sort((a, b) => b.price - a.price).slice(0, 6))
      // أدنى 6 طلبات بيع
      setAsks(orders.filter(o => o.side === 'sell').sort((a, b) => a.price - b.price).slice(0, 6))
    }
  }

  useEffect(() => {
    loadData()
    const ch = supabase.channel('ob')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, loadData).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const maxAmount = Math.max(...bids.map(b => b.amount), ...asks.map(a => a.amount), 1)

  return (
    <div className="flex flex-col h-full text-xs font-mono" dir="ltr">
      {/* العناوين */}
      <div className="flex justify-between text-[10px] text-[#848e9c] mb-1 px-2">
        <span>Price (SDG)</span>
        <span>Amount (NIL)</span>
      </div>

      {/* طلبات البيع (Asks) - حمراء */}
      <div className="flex flex-col-reverse">
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
        {formatNumber(bids[0]?.price || asks[0]?.price || 0)}
      </div>

      {/* طلبات الشراء (Bids) - خضراء */}
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
