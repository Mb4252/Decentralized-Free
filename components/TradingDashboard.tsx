'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase, getUserProfile } from '@/lib/supabase'
import { formatNumber } from '@/lib/utils'
import StatsBar from './StatsBar'
import CandlestickChart from './CandlestickChart'
import OrderBook from './OrderBook'
import P2POrderForm from './P2POrderForm'
import LoginModal from './LoginModal'
import ToastHost from './Toast'

type TF = '15m' | '4h' | '1d'

export default function TradingDashboard() {
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [tf, setTf] = useState<TF>('15m')
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

  async function logout() {
    await supabase.auth.signOut()
    setUser(null); setProfile(null)
  }

  return (
    <div className="min-h-screen bg-[#0b0e11] text-white">
      <ToastHost />
      
      {/* Header */}
      <header className="border-b border-[#2b3139] bg-[#181a20] px-4 py-3 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">NIL/SDG</h1>
          <span className="text-xs text-[#848e9c]">منصة نيل كوين</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {isAdmin && <Link href="/admin" className="text-yellow-500 hover:text-yellow-400">⚙️ الإدارة</Link>}
          {user ? (
            <>
              <span className="text-[#848e9c] hidden sm:inline">{user.email}</span>
              <button onClick={logout} className="text-red-400 hover:text-red-300">خروج</button>
            </>
          ) : (
            <button onClick={() => setShowLogin(true)} className="bg-[#0ecb81] text-black px-4 py-1 rounded font-bold">تسجيل الدخول</button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto p-2 md:p-4 space-y-4">
        <StatsBar />

        {profile && (
          <div className="bg-[#181a20] border border-[#2b3139] rounded p-2 flex flex-wrap gap-4 text-xs">
            <span className="text-[#848e9c]">الرصيد المتاح:</span>
            <span className="text-white font-bold">{formatNumber(profile.nil_balance)} NIL</span>
            <span className="text-white font-bold">{formatNumber(profile.sdg_balance)} SDG</span>
            <span className="text-[#848e9c]">(محجوز: {formatNumber(profile.nil_locked)} NIL / {formatNumber(profile.sdg_locked)} SDG)</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* العمود الأيمن: الرسم البياني */}
          <div className="lg:col-span-2 space-y-2">
            <div className="flex gap-1 bg-[#181a20] p-1 rounded w-fit border border-[#2b3139]">
              {(['15m', '4h', '1d'] as TF[]).map(t => (
                <button key={t} onClick={() => setTf(t)} className={`px-3 py-1 rounded text-xs font-bold transition ${tf === t ? 'bg-[#2b3139] text-white' : 'text-[#848e9c] hover:text-white'}`}>
                  {t === '15m' ? '١٥ دقيقة' : t === '4h' ? '٤ ساعات' : 'يومي'}
                </button>
              ))}
            </div>
            <CandlestickChart timeframe={tf} />
          </div>

          {/* العمود الأيسر: دفتر الطلبات والنموذج */}
          <div className="space-y-4">
            <OrderBook />
            {user ? <P2POrderForm userId={user.id} /> : (
               <div className="bg-[#181a20] border border-[#2b3139] p-6 rounded text-center text-sm text-[#848e9c]">
                  سجّل الدخول لإنشاء طلب P2P
                  <button onClick={() => setShowLogin(true)} className="block w-full mt-3 bg-[#0ecb81] text-black py-2 rounded font-bold">دخول</button>
               </div>
            )}
          </div>
        </div>
      </main>
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </div>
  )
}
