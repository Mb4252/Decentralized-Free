'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [userEmail, setUserEmail] = useState(null)
  const router = useRouter()

  useEffect(() => {
    const user = localStorage.getItem('user')
    if (!user) {
      router.push('/login')
      return
    }
    try {
      const userData = JSON.parse(user)
      if (userData.email) {
        setUserEmail(userData.email)
        setLoading(false)
      } else {
        router.push('/login')
      }
    } catch (e) {
      router.push('/login')
    }
  }, [router])

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">جاري التحميل...</div>
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4">
        <h1 className="text-3xl font-bold mb-4">لوحة التحكم</h1>
        <p>مرحباً {userEmail}</p>
        <button 
          onClick={() => {
            localStorage.removeItem('user')
            router.push('/login')
          }}
          className="bg-red-600 text-white px-4 py-2 rounded"
        >
          تسجيل خروج
        </button>
      </div>
    </div>
  )
}
