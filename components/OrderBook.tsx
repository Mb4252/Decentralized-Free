'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatNumber } from '@/lib/utils'

type BookOrder = { id: string; side: 'buy' | 'sell'; price: number; amount: number }

export default function OrderBook() {
  const [bids, setBids] = useState<BookOrder[]>([])
  const [asks, setAsks] = useState<BookOrder[]>([])

  async function load() {
    const { data } = await supabase
      .from('orders')
      .select('id, side, price, amount')
      .eq('status', 'open')

    if (!data) return
    const buys = data.filter(o => o.side === 'buy').sort((a, b) => b.price - a.price).slice(0, 12)
    const sells = data.filter(o => o.side === 'sell').sort((a, b) => a.price - b.price).slice(0, 12)
    setBids(buys as BookOrder[])
    setAsks(sells as BookOrder[])
  }

  useEffect(() => {
    load()
    const ch = supabase
      .channel(`orderbook-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const spread = asks[0] && bids[0] ? asks[0].price - bids[0].price : 0

  return (
    <div className="bg-slate-900 rounded-lg p-3">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-bold text-sm">دفتر الطلبات</h3>
        <span className="text-[10px] text-slate-400">
          الفرق: {formatNumber(spread)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        {/* Bids */}
        <div>
          <div className="flex justify-between text-slate-400 mb-1 px-1">
            <span>سعر</span>
            <span>كمية</span>
          </div>
          <div className="space-y-0.5 max-h-[280px] overflow-y-auto">
            {bids.map(o => (
              <div key={o.id}
                className="flex justify-between py-1 px-1 rounded bg-green-950/40 border-r-2 border-green-600">
                <span className="text-green-400 font-mono">{formatNumber(o.price)}</span>
                <span className="text-slate-300 font-mono">{formatNumber(o.amount)}</span>
              </div>
            ))}
            {!bids.length && <p className="text-slate-500 text-center py-4">—</p>}
          </div>
        </div>

        {/* Asks */}
        <div>
          <div className="flex justify-between text-slate-400 mb-1 px-1">
            <span>سعر</span>
            <span>كمية</span>
          </div>
          <div className="space-y-0.5 max-h-[280px] overflow-y-auto">
            {asks.map(o => (
              <div key={o.id}
                className="flex justify-between py-1 px-1 rounded bg-red-950/40 border-r-2 border-red-600">
                <span className="text-red-400 font-mono">{formatNumber(o.price)}</span>
                <span className="text-slate-300 font-mono">{formatNumber(o.amount)}</span>
              </div>
            ))}
            {!asks.length && <p className="text-slate-500 text-center py-4">—</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
