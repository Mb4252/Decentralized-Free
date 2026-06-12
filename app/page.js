'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function HomePage() {
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    // استيراد ديناميكي لـ Firebase فقط عند الحاجة
    const checkAuth = async () => {
      try {
        const { auth } = await import('@/lib/firebase/client')
        const { onAuthStateChanged } = await import('firebase/auth')
        
        const unsubscribe = onAuthStateChanged(auth, (user) => {
          if (user) {
            router.push('/dashboard')
          }
          setLoading(false)
        })
        
        return unsubscribe
      } catch (error) {
        console.error('Firebase error:', error)
        setLoading(false)
        return () => {}
      }
    }
    
    const unsubscribePromise = checkAuth()
    return () => {
      unsubscribePromise.then(unsubscribe => unsubscribe && unsubscribe())
    }
  }, [router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">جاري التحميل...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* بقية المحتوى كما هو */}
      <nav className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="text-2xl font-bold text-blue-600">CryptoInvest</div>
          <div className="flex gap-4">
            <Link href="/login" className="px-4 py-2 text-blue-600 hover:text-blue-700 font-medium">تسجيل الدخول</Link>
            <Link href="/login" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">ابدأ الآن</Link>
          </div>
        </div>
      </nav>
      
      <section className="container mx-auto px-4 py-20 text-center">
        <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
          استثمر في العملات الرقمية
          <span className="text-blue-600"> بثقة وأمان</span>
        </h1>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-10">
          منصة استثمارية متطورة تقدم عوائد يومية تصل إلى 3.5% مع نظام إحالات مميز
        </p>
        <Link href="/login" className="px-8 py-3 bg-blue-600 text-white rounded-lg text-lg font-semibold hover:bg-blue-700 transition inline-block">
          ابدأ الاستثمار الآن
        </Link>
      </section>
    </div>
  )
}
