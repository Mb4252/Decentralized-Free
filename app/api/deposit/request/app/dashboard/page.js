'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { auth, signOut } from '@/lib/firebase/client'
import { onAuthStateChanged } from 'firebase/auth'
import { createClient } from '@/lib/supabase/client'
import BalanceCard from '@/components/dashboard/BalanceCard'
import DepositModal from '@/components/dashboard/DepositModal'
import WithdrawModal from '@/components/dashboard/WithdrawModal'
import ReferralSection from '@/components/dashboard/ReferralSection'
import TransactionHistory from '@/components/dashboard/TransactionHistory'

export default function DashboardPage() {
  const [user, setUser] = useState(null)
  const [userData, setUserData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [firebaseToken, setFirebaseToken] = useState(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        router.push('/login')
        return
      }

      setUser(firebaseUser)
      
      // الحصول على token من Firebase
      const token = await firebaseUser.getIdToken()
      setFirebaseToken(token)

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
  }, [router, supabase])

  const handleLogout = async () => {
    await signOut(auth)
    router.push('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="text-2xl mb-4">⏳</div>
          <p className="text-gray-600">جاري التحميل...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navbar */}
      <nav className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="text-2xl font-bold text-blue-600">
            CryptoInvest
          </div>
          <div className="flex items-center gap-4">
            <span className="text-gray-600 hidden md:inline">
              مرحباً {user?.displayName || user?.email?.split('@')[0]}
            </span>
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition"
            >
              تسجيل خروج
            </button>
          </div>
        </div>
      </nav>

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Welcome Section */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800">لوحة التحكم</h1>
          <p className="text-gray-600">مرحباً بعودتك {user?.displayName || ''}</p>
          <p className="text-sm text-gray-500 mt-1">بريدك الإلكتروني: {user?.email}</p>
        </div>

        {/* Balance Cards */}
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

        {/* Action Buttons & Tier Info */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <DepositModal onSuccess={() => window.location.reload()} />
          <WithdrawModal onSuccess={() => window.location.reload()} />
          <div className="bg-white rounded-xl shadow-md p-6 text-center">
            <div className="text-2xl mb-2">🎁</div>
            <h3 className="font-semibold text-gray-800">المستوى الحالي</h3>
            <p className="text-2xl font-bold text-blue-600 mt-2">
              {userData?.tiers?.name || 'مبتدئ'}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              نسبة الربح: {userData?.tiers?.roi_percentage || 2}% يومياً
            </p>
            {userData?.tiers?.min_deposit && (
              <p className="text-xs text-gray-400 mt-2">
                الحد الأدنى للمستوى التالي: {userData.tiers.min_deposit} USDT
              </p>
            )}
          </div>
        </div>

        {/* Referral & Transactions */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ReferralSection userData={userData} />
          <TransactionHistory userId={user?.uid || userData?.id} />
        </div>

        {/* PIN Notice (إذا لم يغير PIN بعد) */}
        {userData?.withdraw_pin === '0000' && (
          <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-yellow-800 text-sm">
              ⚠️ تنبيه: يرجى تغيير PIN السحب الافتراضي الخاص بك من إعدادات الملف الشخصي.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
