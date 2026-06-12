'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase/admin'

export default function DashboardPage() {
  const [user, setUser] = useState(null)
  const [userData, setUserData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('dashboard')
  const [depositAmount, setDepositAmount] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawAddress, setWithdrawAddress] = useState('')
  const [message, setMessage] = useState('')
  const router = useRouter()

  useEffect(() => {
    const storedUser = localStorage.getItem('user')
    if (!storedUser) {
      router.push('/login')
      return
    }

    const userObj = JSON.parse(storedUser)
    setUser(userObj)
    fetchUserData(userObj.email)
  }, [])

  const fetchUserData = async (email) => {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('*, tiers(name, roi_percentage)')
      .eq('email', email)
      .single()

    if (!error && data) {
      setUserData(data)
    }
    setLoading(false)
  }

  const handleDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) < 10) {
      setMessage('الحد الأدنى للإيداع 10 USDT')
      return
    }

    // إنشاء طلب إيداع
    const { data: deposit, error } = await supabaseAdmin
      .from('deposit_requests')
      .insert({
        user_id: userData.id,
        amount: parseFloat(depositAmount),
        status: 'pending'
      })
      .select()
      .single()

    if (error) {
      setMessage('حدث خطأ، حاول مرة أخرى')
      return
    }

    setMessage(`✅ تم إنشاء طلب إيداع بقيمة ${depositAmount} USDT. يرجى إرسال المبلغ إلى المحفظة:`)
  }

  const handleWithdraw = async () => {
    if (!withdrawAmount || parseFloat(withdrawAmount) < 0.5) {
      setMessage('الحد الأدنى للسحب 0.5 USDT')
      return
    }

    if (!withdrawAddress) {
      setMessage('يرجى إدخال عنوان محفظة BSC')
      return
    }

    if (userData.available_balance < parseFloat(withdrawAmount)) {
      setMessage('الرصيد غير كافٍ')
      return
    }

    const { data: withdrawal, error } = await supabaseAdmin
      .from('withdrawals')
      .insert({
        user_id: userData.id,
        amount: parseFloat(withdrawAmount),
        wallet_address: withdrawAddress,
        status: 'pending'
      })
      .select()
      .single()

    if (error) {
      setMessage('حدث خطأ، حاول مرة أخرى')
      return
    }

    // تجميد الرصيد
    await supabaseAdmin
      .from('users')
      .update({ available_balance: userData.available_balance - parseFloat(withdrawAmount) })
      .eq('id', userData.id)

    setMessage('✅ تم إرسال طلب السحب بنجاح، بانتظار الموافقة')
    setWithdrawAmount('')
    setWithdrawAddress('')
    fetchUserData(user.email)
  }

  const handleLogout = () => {
    localStorage.removeItem('user')
    localStorage.removeItem('admin')
    router.push('/login')
  }

  if (loading) {
    return <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">جاري التحميل...</div>
  }

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Navbar */}
      <nav className="bg-gray-800 border-b border-gray-700 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex justify-between items-center">
          <div className="text-2xl font-bold text-yellow-500">CryptoMine</div>
          <div className="flex items-center gap-4">
            <span className="text-gray-300">{user?.email}</span>
            <button onClick={handleLogout} className="text-red-400 hover:text-red-300">تسجيل خروج</button>
          </div>
        </div>
      </nav>

      {/* Tabs */}
      <div className="bg-gray-800 border-b border-gray-700">
        <div className="container mx-auto px-4">
          <div className="flex gap-6">
            {['dashboard', 'deposit', 'withdraw', 'referral'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-3 px-2 transition ${activeTab === tab ? 'text-yellow-500 border-b-2 border-yellow-500' : 'text-gray-400 hover:text-gray-200'}`}
              >
                {tab === 'dashboard' && 'الرئيسية'}
                {tab === 'deposit' && 'إيداع'}
                {tab === 'withdraw' && 'سحب'}
                {tab === 'referral' && 'الإحالات'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && (
          <>
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div className="bg-gradient-to-r from-yellow-600 to-yellow-500 rounded-2xl p-6 text-white">
                <p className="text-sm opacity-90">الاستثمار النشط</p>
                <p className="text-3xl font-bold">{userData?.active_deposit || 0} USDT</p>
                <p className="text-xs opacity-75 mt-2">العائد اليومي: {userData?.tiers?.roi_percentage || 2}%</p>
              </div>
              <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
                <p className="text-sm text-gray-400">الرصيد المتاح للسحب</p>
                <p className="text-3xl font-bold text-white">{userData?.available_balance || 0} USDT</p>
                <button onClick={() => setActiveTab('withdraw')} className="mt-3 text-yellow-500 text-sm hover:text-yellow-400">سحب الآن →</button>
              </div>
            </div>

            {/* Level Info */}
            <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700 mb-8">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-gray-400 text-sm">المستوى الحالي</p>
                  <p className="text-2xl font-bold text-white">{userData?.tiers?.name || 'مبتدئ'}</p>
                </div>
                <div className="text-right">
                  <p className="text-gray-400 text-sm">نسبة الربح اليومي</p>
                  <p className="text-2xl font-bold text-yellow-500">{userData?.tiers?.roi_percentage || 2}%</p>
                </div>
              </div>
            </div>

            {/* Investment Plans */}
            <h2 className="text-xl font-bold text-white mb-4">خطط الاستثمار</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { name: 'مبتدئ', min: 10, roi: '2%' },
                { name: 'محترف', min: 100, roi: '2.5%' },
                { name: 'VIP', min: 500, roi: '3%' },
                { name: 'دياموند', min: 1000, roi: '3.5%' }
              ].map((plan) => (
                <div key={plan.name} className="bg-gray-800 rounded-xl p-4 text-center border border-gray-700 hover:border-yellow-500 transition">
                  <h3 className="font-bold text-white">{plan.name}</h3>
                  <p className="text-yellow-500 text-xl font-bold my-2">{plan.roi}</p>
                  <p className="text-gray-500 text-sm">يومياً</p>
                  <p className="text-gray-600 text-xs mt-2">من {plan.min} USDT</p>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Deposit Tab */}
        {activeTab === 'deposit' && (
          <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700 max-w-md mx-auto">
            <h2 className="text-2xl font-bold text-white mb-4 text-center">إيداع USDT</h2>
            
            {/* Wallet Address */}
            <div className="bg-gray-900 rounded-lg p-4 mb-6 text-center">
              <p className="text-gray-400 text-sm mb-2">أرسل المبلغ إلى هذه المحفظة (شبكة BSC)</p>
              <code className="text-yellow-500 text-sm break-all">0x987cfde723a87b5ed33329eebe0595a4416b848f</code>
              <button 
                onClick={() => navigator.clipboard.writeText('0x987cfde723a87b5ed33329eebe0595a4416b848f')}
                className="block w-full mt-2 text-gray-400 text-sm hover:text-white"
              >
                📋 نسخ العنوان
              </button>
            </div>

            <input
              type="number"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="المبلغ (USDT)"
              className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white mb-4"
            />
            
            <button
              onClick={handleDeposit}
              className="w-full bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold py-3 rounded-lg transition"
            >
              تقديم طلب إيداع
            </button>

            {message && (
              <div className="mt-4 p-3 bg-gray-700 rounded-lg text-sm text-white">
                {message}
              </div>
            )}
          </div>
        )}

        {/* Withdraw Tab */}
        {activeTab === 'withdraw' && (
          <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700 max-w-md mx-auto">
            <h2 className="text-2xl font-bold text-white mb-4 text-center">سحب الأرباح</h2>
            <p className="text-center text-gray-400 mb-4">الرصيد المتاح: <span className="text-yellow-500 font-bold">{userData?.available_balance || 0} USDT</span></p>
            
            <input
              type="number"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder="المبلغ (USDT) - الحد الأدنى 0.5"
              className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white mb-4"
            />
            <input
              type="text"
              value={withdrawAddress}
              onChange={(e) => setWithdrawAddress(e.target.value)}
              placeholder="عنوان محفظة BSC"
              className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white mb-4"
            />
            
            <button
              onClick={handleWithdraw}
              className="w-full bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold py-3 rounded-lg transition"
            >
              طلب سحب
            </button>

            {message && (
              <div className="mt-4 p-3 bg-gray-700 rounded-lg text-sm text-white">
                {message}
              </div>
            )}
          </div>
        )}

        {/* Referral Tab */}
        {activeTab === 'referral' && (
          <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700 text-center">
            <h2 className="text-2xl font-bold text-white mb-4">نظام الإحالات</h2>
            <p className="text-gray-400 mb-4">قم بدعوة أصدقائك واحصل على عمولة 10% من استثماراتهم</p>
            
            <div className="bg-gray-900 rounded-lg p-4 mb-4">
              <p className="text-gray-400 text-sm mb-2">كود الإحالة الخاص بك</p>
              <code className="text-yellow-500 text-2xl font-bold">{userData?.referral_code}</code>
              <button 
                onClick={() => navigator.clipboard.writeText(`${window.location.origin}/login?ref=${userData?.referral_code}`)}
                className="block w-full mt-3 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg transition"
              >
                📋 نسخ رابط الدعوة
              </button>
            </div>

            <p className="text-gray-500 text-sm">كلما زادت دعواتك، زادت أرباحك!</p>
          </div>
        )}
      </div>
    </div>
  )
}
