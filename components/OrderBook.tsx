'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatNumber } from '@/lib/utils'

export default function OrderBook() {
  const [bids, setBids] = useState<any[]>([])
  const [asks, setAsks] = useState<any[]>([])
  const [trades, setTrades] = useState<any[]>([])

  const loadData = async () => {
    const { data: orders } = await supabase.from('orders').select('id, side, price, amount').eq('status', 'open')
    if (orders) {
      setBids(orders.filter(o => o.side === 'buy').sort((a, b) => b.price - a.price).slice(0, 10))
      setAsks(orders.filter(o => o.side === 'sell').sort((a, b) => a.price - b.price).slice(0, 10))
    }

    const { data: t } = await supabase.from('trades').select('id, price, amount, executed_at').order('executed_at', { ascending: false }).limit(15)
    if (t) setTrades(t)
  }

  useEffect(() => {
    loadData()
    const ch = supabase.channel('orderbook-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, loadData)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const bestBid = bids[0]?.price || 0
  const bestAsk = asks[0]?.price || 0
  const maxAmount = Math.max(...bids.map(b => b.amount), ...asks.map(a => a.amount), 1)

  return (
    <div className="bg-[#181a20] rounded-lg border border-[#2b3139] flex flex-col h-[500px]">
      {/* العناوين */}
      <div className="flex justify-between items-center p-2 border-b border-[#2b3139] text-xs font-bold text-white">
        <span>دفتر الطلبات</span>
        <div className="flex gap-2">
          <span className="text-[#0ecb81]">Bid: {formatNumber(bestBid)}</span>
          <span className="text-[#f6465d]">Ask: {formatNumber(bestAsk)}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {/* المبيعات (Asks) */}
        <div>
          <div className="flex justify-between text-[10px] text-[#848e9c] mb-1 px-1">
            <span>السعر (SDG)</span>
            <span>الكمية (NIL)</span>
          </div>
          {asks.map((a, i) => (
            <div key={i} className="relative flex justify-between text-xs py-0.5 px-1 hover:bg-[#2b3139]">
              <div className="absolute inset-y-0 right-0 bg-[#f6465d]/10" style={{ width: `${(a.amount / maxAmount) * 100}%` }} />
              <span className="text-[#f6465d] font-mono z-10">{formatNumber(a.price)}</span>
              <span className="text-white font-mono z-10">{formatNumber(a.amount)}</span>
            </div>
          ))}
        </div>

        {/* السعر الحالي / الصفقات */}
        <div className="border-y border-[#2b3139] py-2">
           <div className="text-lg font-bold text-white px-1">
             {formatNumber(trades[0]?.price || bestBid || 0)} SDG
           </div>
           <div className="flex justify-between text-[10px] text-[#848e9c] px-1 mt-1">
            <span>السعر</span>
            <span>الكمية</span>
            <span>الوقت</span>
           </div>
           {trades.slice(0, 5).map((t, i) => (
              <div key={i} className="flex justify-between text-[10px] px-1 py-0.5">
                <span className="text-[#0ecb81]">{formatNumber(t.price)}</span>
                <span className="text-white">{formatNumber(t.amount)}</span>
                <span className="text-[#848e9c]">{new Date(t.executed_at).toLocaleTimeString('ar-EG')}</span>
              </div>
           ))}
        </div>

        {/* المشتريات (Bids) */}
        <div>
          <div className="flex justify-between text-[10px] text-[#848e9c] mb-1 px-1">
            <span>السعر (SDG)</span>
            <span>الكمية (NIL)</span>
          </div>
          {bids.map((b, i) => (
            <div key={i} className="relative flex justify-between text-xs py-0.5 px-1 hover:bg-[#2b3139]">
              <div className="absolute inset-y-0 right-0 bg-[#0ecb81]/10" style={{ width: `${(b.amount / maxAmount) * 100}%` }} />
              <span className="text-[#0ecb81] font-mono z-10">{formatNumber(b.price)}</span>
              <span className="text-white font-mono z-10">{formatNumber(b.amount)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
