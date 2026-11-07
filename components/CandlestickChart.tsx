'use client'
import { useEffect, useRef, useState } from 'react'
import { createChart, CandlestickSeries, type IChartApi, type ISeriesApi } from 'lightweight-charts'
import { supabase } from '@/lib/supabase'
import { timeToUnix } from '@/lib/utils'

type TF = '15m' | '4h' | '1d'

export default function CandlestickChart({ timeframe }: { timeframe: TF }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const [loading, setLoading] = useState(true)

  // إنشاء الرسم مرة واحدة
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { color: '#0f172a' },
        textColor: '#94a3b8'
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' }
      },
      timeScale: { timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: '#334155' }
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444'
    })

    chartRef.current = chart
    seriesRef.current = series

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [])

  // تحميل البيانات لكل timeframe
  useEffect(() => {
    if (!seriesRef.current) return
    setLoading(true)

    async function load() {
      const { data, error } = await supabase
        .from('candles')
        .select('open_time, open, high, low, close')
        .eq('timeframe', timeframe)
        .order('open_time', { ascending: true })
        .limit(500)

      if (error) {
        console.error(error)
        setLoading(false)
        return
      }

      if (data && seriesRef.current) {
        seriesRef.current.setData(
          data.map(c => ({
            time: timeToUnix(c.open_time) as any,
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close)
          }))
        )
        chartRef.current?.timeScale().fitContent()
      }
      setLoading(false)
    }

    load()

    const ch = supabase
      .channel(`candles-${timeframe}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'candles', filter: `timeframe=eq.${timeframe}` },
        payload => {
          if (!seriesRef.current) return
          const c: any = payload.new
          if (!c) return
          seriesRef.current.update({
            time: timeToUnix(c.open_time) as any,
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close)
          })
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(ch) }
  }, [timeframe])

  return (
    <div className="relative w-full h-[320px] md:h-[420px] rounded-lg overflow-hidden bg-slate-900">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm z-10">
          جاري تحميل الشموع...
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  )
}
