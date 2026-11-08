'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase, getUserProfile } from '@/lib/supabase'
import { formatNumber } from '@/lib/utils'
import CandlestickChart from './CandlestickChart'
import OrderBook from './OrderBook'
import P2POrderForm from './P2POrderForm'
import LoginModal from './LoginModal'
import ToastHost, { toast } from './Toast'

export default function TradingDashboard() {
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [showLogin, setShowLogin] = useState(false)
  const [tf, setTf] = useState<'15m' | '4h' | '1d'>('15m')
  const [bottomTab, setBottomTab] = useState<'open' | 'history'>('open')
  const [myOrders, setMyOrders] = useState<any[]>([])
  const [tradeHistory, setTradeHistory] = useState<any[]>([])
  
  const isAdmin = user?.email === 'mb425262@gmail.com'

  const loadUserData = async (userId: string) => {
    const { data: orders } = await supabase.from('orders').select('*').eq('user_id', userId).eq('status', 'open').order('created_at', { ascending: false })
    if (orders) setMyOrders(orders)

    const { data: trades } = await supabase.from('trades').select('*').or(`buy_order_id.in.(select id from orders where user_id='${userId}'),sell_order_id.in.(select id from orders where user_id='${userId}')`).order('executed_at', { ascending: false }).limit(10)
    if (trades) setTradeHistory(trades)
  }

  useEffect(() => {
    async function loadUser() {
      const { data } = await supabase.auth.getUser()
      setUser(data.user)
      if (data.user) {
        setProfile(await getUserProfile())
        loadUserData(data.user.id)
      }
    }
    loadUser()
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        setProfile(await getUserProfile())
        loadUserData(session.user.id)
      } else {
        setProfile(null); setMyOrders([]); setTradeHistory([])
      }
    })
    return () => { sub.subscription.unsubscribe() }
  }, [])

  async function cancelOrder(orderId: string) {
    if (!confirm('إلغاء الطلب؟')) return
    const { error } = await supabase.from('orders').update({ status: 'cancelled', escrow_locked: false }).eq('id', orderId)
    if (error) toast(error.message, 'error')
    else {
      toast('تم الإلغاء', 'success')
      loadUserData(user.id)
      setProfile(await getUserProfile())
    }
  }

  return (
    // 1. إجبار الخلفية على أن تكون سوداء بالكامل
    <div className="min-h-screen bg-[#0b0e11] text-[#eaecef] font-sans pb-10">
      <ToastHost />
      
      {/* الشريط العلوي */}
      <header className="border-b border-[#2b3139] px-3 py-2 flex justify-between items-center bg-[#181a20] sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center font-bold text-black text-xs">N</div>
          <h1 className="text-base font-bold">NIL/SDG</h1>
        </div>
        <div className="flex gap-2 items-center text-xs">
          {isAdmin && <Link href="/admin" className="text-yellow-500 hover:underline">⚙️</Link>}
          {user ? (
            <button onClick={() => supabase.auth.signOut()} className="bg-[#2b3139] px-2 py-1 rounded hover:bg-[#3b434b]">خروج</button>
          ) : (
            <button onClick={() => setShowLogin(true)} className="bg-[#0ecb81] text-black px-3 py-1 rounded font-bold">دخول</button>
          )}
        </div>
      </header>

      <main className="max-w-md mx-auto space-y-1 bg-[#0b0e11]">
        {/* الأرصدة */}
        {profile && (
          <div className="grid grid-cols-2 text-[10px] bg-[#181a20] p-2 border-b border-[#2b3139]">
            <div>
              <span className="text-[#848e9c] block">الرصيد المتاح</span>
              <span className="text-white font-bold">{formatNumber(profile.nil_balance,0)} NIL</span><br/>
              <span className="text-white font-bold">{formatNumber(profile.sdg_balance,0)} SDG</span>
            </div>
            <div className="text-left">
              <span className="text-[#848e9c] block">المحجوز</span>
              <span className="text-[#f6465d] font-bold">{formatNumber(profile.nil_locked,0)} NIL</span><br/>
              <span className="text-[#f6465d] font-bold">{formatNumber(profile.sdg_locked,0)} SDG</span>
            </div>
          </div>
        )}

        {/* الرسم البياني */}
        <div className="bg-[#181a20] border-b border-[#2b3139]">
           <div className="flex justify-between items-center p-1">
              <div className="flex gap-1">
                {(['15m', '4h', '1d'] as const).map(t => (
                  <button key={t} onClick={() => setTf(t)} className={`px-2 py-1 rounded text-[10px] font-bold ${tf === t ? 'bg-[#2b3139] text-white' : 'text-[#848e9c]'}`}>
                    {t === '15m' ? '15m' : t === '4h' ? '4h' : '1d'}
                  </button>
                ))}
              </div>
           </div>
           <div className="h-[250px]">
              <CandlestickChart timeframe={tf} />
           </div>
        </div>

        {/* 2. القسم الأوسط: دفتر الطلبات + نموذج التداول (مثل Binance) */}
        <div className="grid grid-cols-2 bg-[#181a20] border-y border-[#2b3139] h-[350px]">
          {/* يمين: دفتر الطلبات */}
          <div className="border-l border-[#2b3139] flex flex-col h-full bg-[#181a20]">
            <div className="p-1 text-[10px] text-center border-b border-[#2b3139] font-bold text-white bg-[#1e2329]">Order Book</div>
            <div className="flex-1 overflow-y-auto">
              <OrderBook />
            </div>
          </div>

          {/* يسار: نموذج التداول */}
          <div className="p-2 overflow-y-auto bg-[#181a20]">
            {user ? <P2POrderForm userId={user.id} /> : <div className="text-center text-[#848e9c] mt-10 text-xs">سجل الدخول</div>}
          </div>
        </div>

        {/* التبويبات السفلية */}
        <div className="bg-[#181a20] border-b border-[#2b3139]">
          <div className="flex border-b border-[#2b3139] text-xs">
            <button onClick={() => setBottomTab('open')} className={`flex-1 py-2 font-bold ${bottomTab === 'open' ? 'text-white border-b-2 border-[#0ecb81]' : 'text-[#848e9c]'}`}>الطلبات المفتوحة ({myOrders.length})</button>
            <button onClick={() => setBottomTab('history')} className={`flex-1 py-2 font-bold ${bottomTab === 'history' ? 'text-white border-b-2 border-[#0ecb81]' : 'text-[#848e9c]'}`}>سجل الصفقات</button>
          </div>
          
          <div className="p-2 h-[150px] overflow-y-auto">
            {bottomTab === 'open' ? (
              <table className="w-full text-[10px] text-right font-mono">
                <thead className="text-[#848e9c]">
                  <tr><th className="pb-1">النوع</th><th>السعر</th><th>الكمية</th><th></th></tr>
                </thead>
                <tbody>
                  {myOrders.map(o => (
                    <tr key={o.id} className="border-t border-[#2b3139]/50">
                      <td className={o.side === 'buy' ? 'text-[#0ecb81]' : 'text-[#f6465d]'}>{o.side === 'buy' ? 'شراء' : 'بيع'}</td>
                      <td className="text-white">{formatNumber(o.price, 0)}</td>
                      <td className="text-white">{formatNumber(o.amount, 0)}</td>
                      <td className="text-left py-1">
                        <button onClick={() => cancelOrder(o.id)} className="border border-[#f6465d] text-[#f6465d] px-2 py-0.5 rounded text-[9px]">إلغاء</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-[10px] text-right font-mono">
                <thead className="text-[#848e9c]"><tr><th className="pb-1">السعر</th><th>الكمية</th><th>الوقت</th></tr></thead>
                <tbody>
                  {tradeHistory.map(t => (
                    <tr key={t.id} className="border-t border-[#2b3139]/50">
                      <td className="text-[#0ecb81]">{formatNumber(t.price, 0)}</td>
                      <td className="text-white">{formatNumber(t.amount, 0)}</td>
                      <td className="text-[#848e9c]">{new Date(t.executed_at).toLocaleTimeString('ar-EG')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </div>
  )
}
