'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const handleLogin = async () => {
    setLoading(true)
    setError('')
    
    // محاكاة تسجيل دخول بسيط (للتجربة)
    // لاحظ: هذا مؤقت - ستحتاج إلى إضافة منطق حقيقي لاحقاً
    setTimeout(() => {
      const mockUser = { email: 'test@example.com', name: 'Test User' }
      localStorage.setItem('user', JSON.stringify(mockUser))
      router.push('/dashboard')
      setLoading(false)
    }, 1000)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="bg-white rounded-xl shadow-md p-8 max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">منصة الاستثمار</h1>
          <p className="text-gray-600">تسجيل الدخول (نسخة تجريبية)</p>
        </div>

        {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">{error}</div>}

        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 transition"
        >
          {loading ? 'جاري التحويل...' : 'تسجيل الدخول (تجريبي)'}
        </button>

        <p className="mt-6 text-center text-sm text-gray-500">
          ملاحظة: هذا تسجيل دخول تجريبي مؤقت
        </p>
      </div>
    </div>
  )
}
