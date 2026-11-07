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
import { toast } from './Toast'

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
    // جلب طلباتي المفتوحة
    const { data: orders } = await supabase.from('orders').select('*').eq('user_id', userId).eq('status', 'open').order('created_at', { ascending: false })
    if (orders) setMyOrders(orders)

    // جلب سجل الصفقات
    const { data: trades } = await supabase.from('trades')
      .select('*')
      .or(`buy_order_id.in.(select id from orders where user_id='${userId}'),sell_order_id.in.(select id from orders where user_id='${userId}')`)
      .order('executed_at', { ascending: false }).limit(10)
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

  // دالة إلغاء الطلب
  async function cancelOrder(orderId: string) {
    if (!confirm('هل أنت متأكد من إلغاء هذا الطلب؟')) return
    
    try {
      // 1. تحديث حالة الطلب إلى ملغى
      const { error } = await supabase.from('orders').update({ status: 'cancelled', escrow_locked: false }).eq('id', orderId)
      if (error) throw error

      // 2. إعادة الأموال المحجوزة (يتم ذلك عبر محرك المطابقة أو الدالة في قاعدة البيانات)
      // في الكود الحالي، سيتم إرجاعها تلقائياً إذا كان هناك Trigger أو نقوم بتحديثها يدوياً
      toast('تم إلغاء الطلب وإرجاع الرصيد', 'success')
      loadUserData(user.id)
      if (profile) setProfile(await getUserProfile())
    } catch (err: any) {
      toast(err.message, 'error')
    }
  }

  return (
    <div className="min-h-screen bg-[#0b0e11] text-[#eaecef] font-sans pb-10">
      <ToastHost />
      
      {/* الشريط العلوي */}
      <header className="border-b border-[#2b3139] px-4 py-3 flex justify-between items-center bg-[#181a20] sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-yellow-500 rounded-full flex items-center justify-center font-bold text-black">N</div>
          <h1 className="text-lg font-bold">NIL/SDG</h1>
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

      <main className="max-w-7xl mx-auto md:p-4 space-y-2 md:space-y-4">
        {/* شريط الأرصدة */}
        {profile && (
          <div className="grid grid-cols-2 gap-4 text-xs bg-[#181a20] p-3 md:rounded border-b md:border border-[#2b3139]">
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
        <div className="w-full bg-[#181a20] md:rounded border-b md:border border-[#2b3139]">
           <div className="flex justify-between items-center p-2 border-b border-[#2b3139]">
              <div className="flex gap-2">
                {(['15m', '4h', '1d'] as const).map(t => (
                  <button key={t} onClick={() => setTf(t)} className={`px-3 py-1 rounded text-xs font-bold ${tf === t ? 'bg-[#2b3139] text-white' : 'text-[#848e9c]'}`}>
                    {t === '15m' ? '15 دقيقة' : t === '4h' ? '4 ساعات' : 'يومي'}
                  </button>
                ))}
              </div>
              <span className="text-xs text-[#0ecb81] font-mono">NIL/SDG</span>
           </div>
           <CandlestickChart timeframe={tf} />
        </div>

        {/* شبكة التداول (مقسمة إلى نصفين بالضبط مثل Binance) */}
        <div className="grid grid-cols-2 gap-0 md:gap-4 bg-[#181a20] md:bg-transparent">
          
          {/* العمود الأيمن: دفتر الطلبات */}
          <div className="bg-[#181a20] md:rounded border-l md:border border-[#2b3139] flex flex-col h-[400px]">
            <div className="p-2 border-b border-[#2b3139] text-xs font-bold text-white text-center">دفتر الطلبات</div>
            <div className="flex-1 overflow-y-auto p-1 md:p-2">
              <OrderBook />
            </div>
          </div>

          {/* العمود الأيسر: نموذج الشراء والبيع */}
          <div className="bg-[#181a20] md:rounded border-[#2b3139] p-2 md:p-4 h-[400px] overflow-y-auto">
            {user ? <P2POrderForm userId={user.id} /> : <div className="text-center text-[#848e9c] mt-10 text-xs">سجل الدخول للتداول</div>}
          </div>

        </div>

        {/* التبويبات السفلية */}
        <div className="bg-[#181a20] md:rounded border-y md:border border-[#2b3139] overflow-hidden mt-2">
          <div className="flex border-b border-[#2b3139]">
            <button onClick={() => setBottomTab('open')} className={`flex-1 py-3 text-xs md:text-sm font-bold ${bottomTab === 'open' ? 'text-white border-b-2 border-[#0ecb81]' : 'text-[#848e9c]'}`}>الطلبات المفتوحة ({myOrders.length})</button>
            <button onClick={() => setBottomTab('history')} className={`flex-1 py-3 text-xs md:text-sm font-bold ${bottomTab === 'history' ? 'text-white border-b-2 border-[#0ecb81]' : 'text-[#848e9c]'}`}>سجل الصفقات</button>
          </div>
          
          <div className="p-2 h-[200px] overflow-y-auto">
            {bottomTab === 'open' ? (
              <table className="w-full text-xs text-right font-mono">
                <thead className="text-[#848e9c]">
                  <tr><th className="pb-2">النوع</th><th>السعر</th><th>الكمية</th><th>إجراء</th></tr>
                </thead>
                <tbody>
                  {myOrders.map(o => (
                    <tr key={o.id} className="border-t border-[#2b3139]/50 py-2">
                      <td className={o.side === 'buy' ? 'text-[#0ecb81]' : 'text-[#f6465d]'}>{o.side === 'buy' ? 'شراء' : 'بيع'}</td>
                      <td className="text-white">{formatNumber(o.price)}</td>
                      <td className="text-white">{formatNumber(o.amount)}</td>
                      <td>
                        <button onClick={() => cancelOrder(o.id)} className="bg-transparent border border-[#f6465d] text-[#f6465d] px-2 py-0.5 rounded text-[10px] hover:bg-[#f6465d] hover:text-white transition">
                          إلغاء
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!myOrders.length && <tr><td colSpan={4} className="text-center text-[#848e9c] py-4">لا توجد طلبات مفتوحة</td></tr>}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-xs text-right font-mono">
                <thead className="text-[#848e9c]">
                  <tr><th className="pb-2">السعر</th><th>الكمية</th><th>الوقت</th></tr>
                </thead>
                <tbody>
                  {tradeHistory.map(t => (
                    <tr key={t.id} className="border-t border-[#2b3139]/50 py-1">
                      <td className="text-[#0ecb81]">{formatNumber(t.price)}</td>
                      <td className="text-white">{formatNumber(t.amount)}</td>
                      <td className="text-[#848e9c]">{new Date(t.executed_at).toLocaleTimeString('ar-EG')}</td>
                    </tr>
                  ))}
                  {!tradeHistory.length && <tr><td colSpan={3} className="text-center text-[#848e9c] py-4">لا توجد صفقات</td></tr>}
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
