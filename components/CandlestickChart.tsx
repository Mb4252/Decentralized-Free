'use client'
import { useEffect, useRef } from 'react'
import { createChart } from 'lightweight-charts'

export default function CandlestickChart({ timeframe, livePrice }: { timeframe: string, livePrice: number }) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<any>(null)
  const seriesRef = useRef<any>(null)

  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      layout: { background: { color: '#181a20' }, textColor: '#848e9c' },
      grid: { vertLines: { color: '#2b3139' }, horzLines: { color: '#2b3139' } },
      width: chartContainerRef.current.clientWidth,
      height: 240,
      timeScale: { timeVisible: true, secondsVisible: false },
      // هذا الإعداد هو الذي يمنع ضغط الشموع ويجعلها تملأ الشاشة
      rightPriceScale: {
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
    })

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#0ecb81', downColor: '#f6465d', borderVisible: false, wickUpColor: '#0ecb81', wickDownColor: '#f6465d',
    })

    chartRef.current = chart
    seriesRef.current = candlestickSeries

    // دالة جلب البيانات بناءً على الوقت (محاكاة للـ API الخاص بك)
    const fetchData = () => {
      // هنا يجب أن تجلب البيانات من قاعدة البيانات (Supabase) بناءً على الـ timeframe
      // هذا مثال لبيانات عشوائية لضمان عمل الرسم
      const data = []
      let time = Math.floor(Date.now() / 1000) - 3600 * 24
      let openPrice = 1280
      
      for (let i = 0; i < 50; i++) {
        const closePrice = openPrice + (Math.random() - 0.5) * 10
        const highPrice = Math.max(openPrice, closePrice) + Math.random() * 5
        const lowPrice = Math.min(openPrice, closePrice) - Math.random() * 5
        data.push({ time: time as any, open: openPrice, high: highPrice, low: lowPrice, close: closePrice })
        openPrice = closePrice
        time += (timeframe === '15m' ? 900 : timeframe === '4h' ? 14400 : 86400)
      }
      candlestickSeries.setData(data)
      chart.timeScale().fitContent() // لضبط العرض
    }

    fetchData()

    const handleResize = () => {
      chart.applyOptions({ width: chartContainerRef.current?.clientWidth })
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [timeframe]) // يتم إعادة الرسم عند تغيير الإطار الزمني

  // تحديث السعر الحي (الشمعة الأخيرة)
  useEffect(() => {
    if (seriesRef.current && livePrice) {
      seriesRef.current.update({
        time: Math.floor(Date.now() / 1000) as any,
        open: livePrice, high: livePrice, low: livePrice, close: livePrice
      })
    }
  }, [livePrice])

  return <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
}
