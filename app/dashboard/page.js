'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase/client'
import { onAuthStateChanged } from 'firebase/auth'
import { createClient } from '@/lib/supabase/client'

export default function DashboardPage() {
  const [user, setUser] = useState(null)
  const [userData, setUserData] = useState(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        router.push('/login')
        return
      }

      setUser(firebaseUser)

      // جلب بيانات المستخدم من Supabase
      const { data, error } = await supabase
        .from('users')
        .select('*, tiers(name, roi_percentage)')
        .eq('email', firebaseUser.email)
        .single()

      if (!error && data) {
        setUserData(data)
      }
      setLoading(false)
    })

    return () => unsubscribe()
  }, [router])

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">جاري التحميل...</div>
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4">
        <h1 className="text-3xl font-bold mb-4">مرحباً {user?.displayName}</h1>
        <p>بريدك: {user?.email}</p>
        <p>الاستثمار النشط: {userData?.active_deposit || 0} USDT</p>
        <p>الرصيد المتاح: {userData?.available_balance || 0} USDT</p>
        <p>المستوى: {userData?.tiers?.name || 'مبتدئ'}</p>
      </div>
    </div>
  )
}
