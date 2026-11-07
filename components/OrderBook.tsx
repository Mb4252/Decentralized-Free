'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatNumber } from '@/lib/utils'

export default function OrderBook() {
  const [bids, setBids] = useState<any[]>([])
  const [asks, setAsks] = useState<any[]>([])
  const [trades, setTrades] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    // جلب دفتر الطلبات
    const { data: orders } = await supabase
      .from('orders')
      .select('id, side, price, amount')
      .eq('status', 'open')
    
    if (orders) {
      const buys = orders.filter(o => o.side === 'buy').sort((a, b) => b.price - a.price).slice(0, 10)
      const sells = orders.filter(o => o.side === 'sell').sort((a, b) => a.price - b.price).slice(0, 10)
      setBids(buys)
      setAsks(sells)
    }

    // جلب آخر الصفقات
    const { data: tradesData } = await supabase
      .from('trades')
      .select('id, price, amount, executed_at')
      .order('executed_at', { ascending: false })
      .limit(15)
    
    if (tradesData) setTrades(tradesData)
    setLoading(false)
  }

  useEffect(() => {
    loadData()
    // الاشتراك في التحديثات اللحظية
    const ch = supabase
      .channel('orderbook-trades-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, loadData)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const bestBid = bids[0]?.price || 0
  const bestAsk = asks[0]?.price || 0
  const spread = bestAsk - bestBid
  
  // حساب أعلى كمية لتحديد طول الشريط المضيء
  const maxAmount = Math.max(...bids.map(b => b.amount), ...asks.map(a => a.amount), 1)

  return (
    <div className="bg-slate-900 rounded-lg p-3 flex flex-col h-full min-h-[500px]">
      <div className="flex justify-between items-center mb-3 border-b border-slate-800 pb-2">
        <h3 className="font-bold text-sm text-white">سوق NIL/SDG</h3>
        <div className="flex gap-2 text-xs">
          <span className="text-green-400">Bid: {formatNumber(bestBid)}</span>
          <span className="text-red-400">Ask: {formatNumber(bestAsk)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 flex-1">
        {/* Bids (الشراء) */}
        <div>
          <div className="flex justify-between text-[10px] text-slate-400 mb-1 px-1">
            <span>سعر (SDG)</span>
            <span>كمية (NIL)</span>
          </div>
          <div className="space-y-0.5">
            {bids.map((b, i) => (
              <div key={i} className="relative flex justify-between text-xs py-0.5 px-1 cursor-pointer hover:bg-slate-800">
                <div className="absolute inset-y-0 right-0 bg-green-500/10" style={{ width: `${(b.amount / maxAmount) * 100}%` }} />
                <span className="text-green-500 font-mono z-10">{formatNumber(b.price)}</span>
                <span className="text-slate-300 font-mono z-10">{formatNumber(b.amount)}</span>
              </div>
            ))}
            {!bids.length && <p className="text-center text-xs text-slate-500 py-2">لا يوجد مشترين</p>}
          </div>
        </div>

        {/* Asks (البيع) */}
        <div>
          <div className="flex justify-between text-[10px] text-slate-400 mb-1 px-1">
            <span>سعر (SDG)</span>
            <span>كمية (NIL)</span>
          </div>
          <div className="space-y-0.5">
            {asks.map((a, i) => (
              <div key={i} className="relative flex justify-between text-xs py-0.5 px-1 cursor-pointer hover:bg-slate-800">
                <div className="absolute inset-y-0 right-0 bg-red-500/10" style={{ width: `${(a.amount / maxAmount) * 100}%` }} />
                <span className="text-red-500 font-mono z-10">{formatNumber(a.price)}</span>
                <span className="text-slate-300 font-mono z-10">{formatNumber(a.amount)}</span>
              </div>
            ))}
            {!asks.length && <p className="text-center text-xs text-slate-500 py-2">لا يوجد بائعين</p>}
          </div>
        </div>
      </div>

      {/* قسم آخر الصفقات */}
      <div className="mt-4 border-t border-slate-800 pt-2">
        <h4 className="text-xs text-slate-400 mb-1">آخر الصفقات (Trades)</h4>
        <div className="space-y-0.5 max-h-[150px] overflow-y-auto">
          {trades.map((t, i) => (
            <div key={i} className="flex justify-between text-[11px] px-1">
              <span className="text-slate-300 font-mono">{formatNumber(t.price)}</span>
              <span className="text-slate-400 font-mono">{formatNumber(t.amount)} NIL</span>
              <span className="text-slate-500">{new Date(t.executed_at).toLocaleTimeString('ar-EG')}</span>
            </div>
          ))}
          {!trades.length && <p className="text-xs text-slate-500">لا توجد صفقات بعد</p>}
        </div>
      </div>
    </div>
  )
}
