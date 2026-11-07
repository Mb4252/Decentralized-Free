'use client'
import { useEffect, useRef, useState } from 'react'
import { createChart, CandlestickSeries } from 'lightweight-charts'
import { supabase } from '@/lib/supabase'
import { timeToUnix } from '@/lib/utils'

type TF = '15m' | '4h' | '1d'

export default function CandlestickChart({ timeframe }: { timeframe: TF }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const seriesRef = useRef<any>(null)
  const chartRef = useRef<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: '#181a20' }, textColor: '#848e9c' },
      grid: { vertLines: { color: '#2b3139' }, horzLines: { color: '#2b3139' } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2b3139' },
      rightPriceScale: { borderColor: '#2b3139' },
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#0ecb81', downColor: '#f6465d',
      borderUpColor: '#0ecb81', borderDownColor: '#f6465d',
      wickUpColor: '#0ecb81', wickDownColor: '#f6465d',
    })

    chartRef.current = chart
    seriesRef.current = series

    return () => chart.remove()
  }, [])

  useEffect(() => {
    if (!seriesRef.current) return
    setLoading(true)

    async function load() {
      const { data } = await supabase.from('candles')
        .select('open_time, open, high, low, close')
        .eq('timeframe', timeframe)
        .order('open_time', { ascending: true })
        .limit(500)

      if (data && seriesRef.current) {
        seriesRef.current.setData(data.map(c => ({
          time: timeToUnix(c.open_time),
          open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close)
        })))
        chartRef.current?.timeScale().fitContent()
      }
      setLoading(false)
    }

    load()

    const ch = supabase.channel(`candles-${timeframe}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'candles', filter: `timeframe=eq.${timeframe}` }, payload => {
        if (!seriesRef.current) return
        const c: any = payload.new
        seriesRef.current.update({
          time: timeToUnix(c.open_time),
          open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close)
        })
      }).subscribe()

    return () => { supabase.removeChannel(ch) }
  }, [timeframe])

  return (
    <div className="relative w-full h-[300px] md:h-[400px] bg-[#181a20] rounded-lg border border-[#2b3139]">
      {loading && <div className="absolute inset-0 flex items-center justify-center text-[#848e9c] text-sm z-10">جاري تحميل الشموع...</div>}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  )
}
