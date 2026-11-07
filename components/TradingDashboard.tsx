'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase, getUserProfile } from '@/lib/supabase'
import { formatNumber } from '@/lib/utils'
import CandlestickChart from './CandlestickChart'
import OrderBook from './OrderBook'
import P2POrderForm from './P2POrderForm'
import LoginModal from './LoginModal'
import ToastHost from './Toast'

export default function TradingDashboard() {
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [showLogin, setShowLogin] = useState(false)
  const isAdmin = user?.email === 'mb425262@gmail.com'

  useEffect(() => {
    async function loadUser() {
      const { data } = await supabase.auth.getUser()
      setUser(data.user)
      if (data.user) setProfile(await getUserProfile())
    }
    loadUser()
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, session) => {
      setUser(session?.user ?? null)
      if (session?.user) setProfile(await getUserProfile())
      else setProfile(null)
    })
    return () => { sub.subscription.unsubscribe() }
  }, [])

  return (
    <div className="min-h-screen bg-[#0b0e11] text-[#eaecef] font-sans">
      <ToastHost />
      
      {/* الشريط العلوي (Header) */}
      <header className="border-b border-[#2b3139] px-4 py-3 flex justify-between items-center bg-[#181a20]">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center font-bold text-black text-xs">N</div>
          <h1 className="text-lg font-bold">NIL/SDG</h1>
          <span className="text-[#0ecb81] text-xs font-bold bg-[#0ecb81]/10 px-2 py-0.5 rounded">+2.45%</span>
        </div>
        <div className="flex gap-3 items-center">
          {isAdmin && <Link href="/admin" className="text-yellow-500 text-sm">⚙️ الأدمن</Link>}
          {user ? (
            <button onClick={() => supabase.auth.signOut()} className="text-sm text-[#848e9c] hover:text-white">خروج</button>
          ) : (
            <button onClick={() => setShowLogin(true)} className="bg-[#0ecb81] text-black px-4 py-1.5 rounded text-sm font-bold">تسجيل الدخول</button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-2 lg:p-4 space-y-4">
        {/* الرصيد المتاح */}
        {profile && (
          <div className="grid grid-cols-2 gap-2 text-xs bg-[#181a20] p-3 rounded-lg border border-[#2b3139]">
            <div className="text-[#848e9c]">الرصيد المتاح:</div>
            <div className="text-left font-bold text-[#0ecb81]">{formatNumber(profile.nil_balance)} NIL</div>
            <div className="text-[#848e9c]">المحجوز (Escrow):</div>
            <div className="text-left font-bold text-[#f6465d]">{formatNumber(profile.nil_locked)} NIL</div>
          </div>
        )}

        {/* الرسم البياني - يظهر في الأعلى على الجوال، وعلى اليسار في الشاشات الكبيرة */}
        <div className="w-full">
           <CandlestickChart timeframe="15m" />
        </div>

        {/* شبكة التداول: دفتر الطلبات (يمين) + نموذج التداول (يسار) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          
          {/* دفتر الطلبات (Order Book) */}
          <div className="bg-[#181a20] rounded-lg border border-[#2b3139] overflow-hidden flex flex-col h-[500px]">
            <div className="flex border-b border-[#2b3139] text-sm">
              <div className="flex-1 text-center py-2 font-bold text-white border-b-2 border-[#0ecb81]">دفتر الطلبات</div>
              <div className="flex-1 text-center py-2 text-[#848e9c]">آخر الصفقات</div>
            </div>
            <div className="flex-1 p-2 overflow-y-auto">
              <OrderBook />
            </div>
          </div>

          {/* نموذج الشراء/البيع (P2P Order Form) */}
          <div className="bg-[#181a20] rounded-lg border border-[#2b3139] p-4">
            {user ? (
              <P2POrderForm userId={user.id} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-10">
                <p className="text-[#848e9c] mb-4">سجّل الدخول للتداول</p>
                <button onClick={() => setShowLogin(true)} className="bg-[#0ecb81] text-black px-6 py-2 rounded font-bold">تسجيل الدخول</button>
              </div>
            )}
          </div>

        </div>
      </main>
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </div>
  )
}
