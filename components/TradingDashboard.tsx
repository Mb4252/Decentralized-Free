'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import StatsBar from './StatsBar'
import CandlestickChart from './CandlestickChart'
import OrderBook from './OrderBook'
import P2POrderForm from './P2POrderForm'
import LoginModal from './LoginModal'
import ToastHost from './Toast'

type TF = '15m' | '4h' | '1d'

export default function TradingDashboard() {
  const [user, setUser] = useState<any>(null)
  const [tf, setTf] = useState<TF>('15m')
  const [showLogin, setShowLogin] = useState(false)
  
  // فحص الأدمن مباشرة من البريد الإلكتروني لضمان ظهور الزر
  const isAdmin = user?.email === 'mb425262@gmail.com'

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
    })
    return () => { sub.subscription.unsubscribe() }
  }, [])

  async function logout() {
    await supabase.auth.signOut()
    setUser(null)
  }

  return (
    <div className="max-w-5xl mx-auto p-3 md:p-4 space-y-3">
      <ToastHost />

      <header className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg md:text-xl font-bold text-white">
            منصة نيل كوين <span className="text-blue-400">NIL/SDG</span>
          </h1>
          <p className="text-[10px] text-slate-500">تداول آمن عبر بنكك</p>
        </div>
        <div className="flex items-center gap-2">
          {/* زر الأدمن يظهر الآن بمجرد تسجيل الدخول بالبريد المحدد */}
          {isAdmin && (
            <Link href="/admin"
              className="text-xs bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded font-bold">
              ⚙️ لوحة الأدمن
            </Link>
          )}
          {user ? (
            <>
              <span className="text-xs text-slate-400 hidden sm:inline">{user.email}</span>
              <button onClick={logout}
                className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded text-white">
                خروج
              </button>
            </>
          ) : (
            <button onClick={() => setShowLogin(true)}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded font-bold">
              دخول / تسجيل
            </button>
          )}
        </div>
      </header>

      <StatsBar />

      <div className="flex gap-2">
        {(['15m', '4h', '1d'] as TF[]).map(t => (
          <button key={t} onClick={() => setTf(t)}
            className={`px-3 py-1.5 rounded text-xs font-bold transition ${
              tf === t ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'
            }`}>
            {t === '15m' ? '١٥ دقيقة' : t === '4h' ? '٤ ساعات' : 'يومي'}
          </button>
        ))}
      </div>

      <CandlestickChart timeframe={tf} />

      <div className="grid md:grid-cols-2 gap-3">
        <OrderBook />
        {user ? (
          <P2POrderForm userId={user.id} />
        ) : (
          <div className="bg-slate-900 rounded-lg p-6 flex flex-col items-center justify-center text-center">
            <p className="text-slate-400 text-sm mb-3">سجّل الدخول لإنشاء طلب P2P</p>
            <button onClick={() => setShowLogin(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-bold text-sm">
              تسجيل الدخول
            </button>
          </div>
        )}
      </div>

      <footer className="text-center text-[10px] text-slate-600 pt-4">
        © {new Date().getFullYear()} منصة نيل كوين — جميع الحقوق محفوظة
      </footer>

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </div>
  )
}
