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

    // إجبار الاتجاه ليكون من اليسار لليمين لضمان ظهور الشموع صحيحة
    containerRef.current.setAttribute('dir', 'ltr')

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 250, // تم ضبط الارتفاع ليناسب شاشة الجوال
      layout: { background: { color: '#181a20' }, textColor: '#848e9c' },
      grid: { vertLines: { color: '#2b3139' }, horzLines: { color: '#2b3139' } },
      timeScale: { 
        timeVisible: true, 
        secondsVisible: false, 
        borderColor: '#2b3139',
        minBarSpacing: 2 // يمنع الشموع من التداخل على الشاشات الصغيرة
      },
      rightPriceScale: { borderColor: '#2b3139' },
    })

    // استخدام الطريقة المتوافقة مع الإصدار الرابع (v4)
    const series = chart.addCandlestickSeries({
      upColor: '#0ecb81', downColor: '#f6465d',
      borderUpColor: '#0ecb81', borderDownColor: '#f6465d',
      wickUpColor: '#0ecb81', wickDownColor: '#f6465d',
    })

    chartRef.current = chart
    seriesRef.current = series

    // تحديث حجم الرسم البياني عند تغيير حجم الشاشة
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
      const { data, error } = await supabase.from('candles')
        .select('open_time, open, high, low, close')
        .eq('timeframe', timeframe)
        .order('open_time', { ascending: true })

      if (error) console.error(error)

      if (data && seriesRef.current) {
        const formattedData = data.map(c => ({
          time: (Math.floor(new Date(c.open_time).getTime() / 1000)) as any,
          open: Number(c.open), 
          high: Number(c.high), 
          low: Number(c.low), 
          close: Number(c.close)
        }))
        
        // 1. فلترة أي شمعة قيمتها 0 أو قيمة شاذة (أقل من 10 أو أكبر من 5000)
        // 2. ترتيب البيانات زمنياً
        const cleanData = formattedData
          .filter(d => d.open > 10 && d.open < 5000)
          .sort((a, b) => a.time - b.time)
        
        seriesRef.current.setData(cleanData)
        chartRef.current?.timeScale().fitContent()
      }
      setLoading(false)
    }

    load()

    // الاشتراك في التحديثات اللحظية للشموع
    const ch = supabase.channel(`candles-${timeframe}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'candles', filter: `timeframe=eq.${timeframe}` }, payload => {
        if (!seriesRef.current) return
        const c: any = payload.new
        if (!c) return
        
        const newCandle = {
          time: (Math.floor(new Date(c.open_time).getTime() / 1000)) as any,
          open: Number(c.open), 
          high: Number(c.high), 
          low: Number(c.low), 
          close: Number(c.close)
        }

        // تحديث الرسم فقط إذا كانت الشمعة الجديدة سليمة
        if (newCandle.open > 10 && newCandle.open < 5000) {
          seriesRef.current.update(newCandle)
        }
      }).subscribe()

    return () => { supabase.removeChannel(ch) }
  }, [timeframe])

  return (
    <div className="relative w-full bg-[#181a20] overflow-hidden">
      {loading && <div className="absolute inset-0 flex items-center justify-center text-[#848e9c] text-sm z-10">جاري التحميل...</div>}
      <div ref={containerRef} className="w-full h-[250px]" />
    </div>
  )
}
