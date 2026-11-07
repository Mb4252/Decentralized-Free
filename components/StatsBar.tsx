'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatNumber } from '@/lib/utils'
import type { MarketStats } from '@/lib/types'

export default function StatsBar() {
  const [stats, setStats] = useState<MarketStats>({ price: 0, volume24h: 0, liquidity: 0 })

  async function load() {
    const since24h = new Date(Date.now() - 86400000).toISOString()

    const [{ data: trades }, { data: openOrders }] = await Promise.all([
      supabase.from('trades').select('price, amount').gte('executed_at', since24h).order('executed_at', { ascending: false }),
      supabase.from('orders').select('price, amount').eq('status', 'open')
    ])

    const price = trades?.[0]?.price ?? 0
    const volume24h = trades?.reduce((s, t) => s + Number(t.amount), 0) ?? 0
    const liquidity = openOrders?.reduce((s, o) => s + Number(o.price) * Number(o.amount), 0) ?? 0

    setStats({ price, volume24h, liquidity })
  }

  useEffect(() => {
    load()
    const ch = supabase.channel('stats-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, load)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  return (
    <div className="grid grid-cols-3 gap-2 md:gap-3">
      <div className="bg-slate-900 rounded-lg p-3 text-center">
        <p className="text-slate-400 text-[10px] md:text-xs">السعر الحالي (SDG)</p>
        <p className="text-base md:text-xl font-bold text-green-400">
          {stats.price ? formatNumber(stats.price) : '—'}
        </p>
      </div>
      <div className="bg-slate-900 rounded-lg p-3 text-center">
        <p className="text-slate-400 text-[10px] md:text-xs">حجم 24س (NIL)</p>
        <p className="text-base md:text-xl font-bold">{formatNumber(stats.volume24h, 0)}</p>
      </div>
      <div className="bg-slate-900 rounded-lg p-3 text-center">
        <p className="text-slate-400 text-[10px] md:text-xs">السيولة (SDG)</p>
        <p className="text-base md:text-xl font-bold">{formatNumber(stats.liquidity, 0)}</p>
      </div>
    </div>
  )
}
