'use client'
import { useEffect, useRef, useState } from 'react'
import { createChart, CandlestickSeries } from 'lightweight-charts'
import { supabase } from '@/lib/supabase'

type TF = '15m' | '4h' | '1d'

export default function CandlestickChart({ timeframe }: { timeframe: TF }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const seriesRef = useRef<any>(null)
  const chartRef = useRef<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!containerRef.current) return

    // إجبار الاتجاه ليكون من اليسار لليمين لضمان ظهور الشموع صحيحة
    containerRef.current.setAttribute('dir', 'ltr')

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 300,
      layout: { background: { color: '#181a20' }, textColor: '#848e9c' },
      grid: { vertLines: { color: '#2b3139' }, horzLines: { color: '#2b3139' } },
      timeScale: { timeVisible: true, borderColor: '#2b3139' },
      rightPriceScale: { borderColor: '#2b3139' },
    })

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#0ecb81', downColor: '#f6465d',
      borderUpColor: '#0ecb81', borderDownColor: '#f6465d',
      wickUpColor: '#0ecb81', wickDownColor: '#f6465d',
    })

    chartRef.current = chart
    seriesRef.current = series

    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth })
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
      const { data, error } = await supabase.from('candles')
        .select('open_time, open, high, low, close')
        .eq('timeframe', timeframe)
        .order('open_time', { ascending: true })

      if (error) console.error(error)

      if (data && seriesRef.current && data.length > 0) {
        const formattedData = data.map(c => ({
          time: (Math.floor(new Date(c.open_time).getTime() / 1000)) as any,
          open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close)
        }))
        
        // فلترة البيانات للتأكد من ترتيبها الزمني الصحيح
        const sortedData = formattedData.sort((a, b) => a.time - b.time)
        
        seriesRef.current.setData(sortedData)
        chartRef.current?.timeScale().fitContent()
      }
      setLoading(false)
    }

    load()
  }, [timeframe])

  return (
    <div className="relative w-full bg-[#181a20] rounded-lg border border-[#2b3139] overflow-hidden">
      {loading && <div className="absolute inset-0 flex items-center justify-center text-[#848e9c] text-sm z-10">جاري التحميل...</div>}
      <div ref={containerRef} className="w-full h-[300px]" />
    </div>
  )
}
