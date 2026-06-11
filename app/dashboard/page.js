'use client'

import { useSession } from "next-auth/react"
import { redirect } from "next/navigation"
import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import BalanceCard from "@/components/dashboard/BalanceCard"
import DepositModal from "@/components/dashboard/DepositModal"
import WithdrawModal from "@/components/dashboard/WithdrawModal"
import ReferralSection from "@/components/dashboard/ReferralSection"
import TransactionHistory from "@/components/dashboard/TransactionHistory"

export default function DashboardPage() {
  const { data: session, status } = useSession()
  const [userData, setUserData] = useState(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()
  
  useEffect(() => {
    if (status === 'unauthenticated') {
      redirect('/login')
    }
    
    if (session?.user?.id) {
      fetchUserData()
    }
  }, [session, status])
  
  const fetchUserData = async () => {
    const { data, error } = await supabase
      .from('users')
      .select(`
        *,
        tiers (name, roi_percentage)
      `)
      .eq('id', session.user.id)
      .single()
    
    if (!error && data) {
      setUserData(data)
    }
    setLoading(false)
  }
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">جاري التحميل...</div>
      </div>
    )
  }
  
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4 max-w-6xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800">لوحة التحكم</h1>
          <p className="text-gray-600">مرحباً {session?.user?.name}</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <BalanceCard 
            title="الاستثمار النشط"
            amount={userData?.active_deposit || 0}
            type="active"
            icon="📈"
          />
          <BalanceCard 
            title="رصيد الأرباح المتاح"
            amount={userData?.available_balance || 0}
            type="available"
            icon="💰"
          />
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <DepositModal onSuccess={fetchUserData} />
          <WithdrawModal onSuccess={fetchUserData} />
          <div className="card text-center">
            <div className="text-2xl mb-2">🎁</div>
            <h3 className="font-semibold">المستوى الحالي</h3>
            <p className="text-2xl font-bold text-blue-600">{userData?.tiers?.name || 'مبتدئ'}</p>
            <p className="text-sm text-gray-500">نسبة الربح: {userData?.tiers?.roi_percentage || 2}% يومياً</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ReferralSection userData={userData} />
          <TransactionHistory userId={session.user.id} />
        </div>
      </div>
    </div>
  )
}
