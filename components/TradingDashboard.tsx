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
    <div className="min-h-screen bg-[#0b0e11] text-[#eaecef] font-sans pb-10">
      <ToastHost />
      
      {/* الشريط العلوي */}
      <header className="border-b border-[#2b3139] px-4 py-3 flex justify-between items-center bg-[#181a20] sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-yellow-500 rounded-full flex items-center justify-center font-bold text-black">N</div>
          <h1 className="text-xl font-bold">NIL/SDG</h1>
          <span className="text-[#0ecb81] text-xs font-bold bg-[#0ecb81]/10 px-2 py-1 rounded">+2.45%</span>
        </div>
        <div className="flex gap-3 items-center">
          {isAdmin && <Link href="/admin" className="text-yellow-500 text-sm hover:underline">⚙️ الأدمن</Link>}
          {user ? (
            <button onClick={() => supabase.auth.signOut()} className="text-xs bg-[#2b3139] px-3 py-1.5 rounded hover:bg-[#3b434b]">خروج</button>
          ) : (
            <button onClick={() => setShowLogin(true)} className="bg-[#0ecb81] text-black px-4 py-1.5 rounded text-xs font-bold hover:opacity-90">دخول</button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-2 md:p-4 space-y-4">
        {/* شريط الأرصدة */}
        {profile && (
          <div className="grid grid-cols-2 gap-4 text-xs bg-[#181a20] p-3 rounded-lg border border-[#2b3139]">
            <div>
              <span className="text-[#848e9c] block mb-1">الرصيد المتاح</span>
              <div className="flex justify-between">
                <span className="text-white font-bold">{formatNumber(profile.nil_balance)} <span className="text-[10px] text-[#848e9c]">NIL</span></span>
                <span className="text-white font-bold">{formatNumber(profile.sdg_balance)} <span className="text-[10px] text-[#848e9c]">SDG</span></span>
              </div>
            </div>
            <div>
              <span className="text-[#848e9c] block mb-1">المحجوز (Escrow)</span>
              <div className="flex justify-between">
                <span className="text-[#f6465d] font-bold">{formatNumber(profile.nil_locked)} <span className="text-[10px] text-[#848e9c]">NIL</span></span>
                <span className="text-[#f6465d] font-bold">{formatNumber(profile.sdg_locked)} <span className="text-[10px] text-[#848e9c]">SDG</span></span>
              </div>
            </div>
          </div>
        )}

        {/* الرسم البياني */}
        <div className="w-full bg-[#181a20] rounded-lg border border-[#2b3139] p-2">
           <div className="flex justify-between items-center mb-2 px-2">
              <div className="flex gap-2">
                <span className="text-sm font-bold text-white border-b-2 border-[#0ecb81] pb-1">شموع 15 دقيقة</span>
              </div>
           </div>
           <CandlestickChart timeframe="15m" />
        </div>

        {/* شبكة التداول */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          
          {/* دفتر الطلبات (يمين) */}
          <div className="bg-[#181a20] rounded-lg border border-[#2b3139] flex flex-col h-[450px]">
            <div className="flex border-b border-[#2b3139] text-sm">
              <div className="flex-1 text-center py-3 font-bold text-white border-b-2 border-[#0ecb81]">دفتر الطلبات</div>
              <div className="flex-1 text-center py-3 text-[#848e9c]">آخر الصفقات</div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              <OrderBook />
            </div>
          </div>

          {/* نموذج الشراء/البيع (يسار) */}
          <div className="bg-[#181a20] rounded-lg border border-[#2b3139] p-4 h-[450px] overflow-y-auto">
            {user ? (
              <P2POrderForm userId={user.id} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full">
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
