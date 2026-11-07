'use client'
import { useEffect, useRef, useState } from 'react'
import { createChart } from 'lightweight-charts'
import { supabase } from '@/lib/supabase'

type TF = '15m' | '4h' | '1d'

export default function CandlestickChart({ timeframe }: { timeframe: TF }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const seriesRef = useRef<any>(null)
  const chartRef = useRef<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!containerRef.current) return

    // إجبار المكتبة على العمل من اليسار لليمين (LTR) حتى لا تنعكس الشموع
    containerRef.current.setAttribute('dir', 'ltr')

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 350,
      layout: { background: { color: '#181a20' }, textColor: '#848e9c' },
      grid: { vertLines: { color: '#2b3139' }, horzLines: { color: '#2b3139' } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2b3139' },
      rightPriceScale: { borderColor: '#2b3139' },
    })

    const series = chart.addCandlestickSeries({
      upColor: '#0ecb81', downColor: '#f6465d',
      borderUpColor: '#0ecb81', borderDownColor: '#f6465d',
      wickUpColor: '#0ecb81', wickDownColor: '#f6465d',
    })

    chartRef.current = chart
    seriesRef.current = series

    // مراقبة تغير حجم الشاشة
    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
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
        const formattedData = data.map(c => ({
          time: Math.floor(new Date(c.open_time).getTime() / 1000),
          open: Number(c.open), 
          high: Number(c.high), 
          low: Number(c.low), 
          close: Number(c.close)
        }))
        
        seriesRef.current.setData(formattedData)
        chartRef.current?.timeScale().fitContent()
      }
      setLoading(false)
    }

    load()
  }, [timeframe])

  return (
    <div className="relative w-full bg-[#181a20] rounded-lg border border-[#2b3139] overflow-hidden">
      {loading && <div className="absolute inset-0 flex items-center justify-center text-[#848e9c] text-sm z-10">جاري تحميل الشموع...</div>}
      {/* تم تحديد ارتفاع ثابت هنا لضمان الظهور */}
      <div ref={containerRef} className="w-full h-[350px]" />
    </div>
  )
}
