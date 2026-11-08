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
  const [tf, setTf] = useState<'15m' | '4h' | '1d'>('15m')
  const [myOrders, setMyOrders] = useState<any[]>([])

  const isAdmin = user?.email === 'mb425262@gmail.com'

  useEffect(() => {
    async function loadUser() {
      const { data } = await supabase.auth.getUser()
      setUser(data.user)
      if (data.user) {
        setProfile(await getUserProfile())
        const { data: orders } = await supabase.from('orders').select('*').eq('user_id', data.user.id).eq('status', 'open')
        if (orders) setMyOrders(orders)
      }
    }
    loadUser()
  }, [])

  async function cancelOrder(id: string) {
    if (!confirm('إلغاء الطلب؟')) return
    await supabase.from('orders').update({ status: 'cancelled', escrow_locked: false }).eq('id', id)
    window.location.reload()
  }

  return (
    <div className="min-h-screen bg-[#0b0e11] text-[#eaecef] font-sans pb-10" dir="rtl">
      <ToastHost />
      
      {/* الشريط العلوي */}
      <header className="border-b border-[#2b3139] px-4 py-3 flex justify-between items-center bg-[#181a20]">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold">NIL/SDG</h1>
          <span className="text-[#0ecb81] text-xs">+2.45%</span>
        </div>
        <div className="flex gap-2 items-center text-xs">
          {isAdmin && <Link href="/admin" className="text-yellow-500">⚙️</Link>}
          {user ? <button onClick={() => supabase.auth.signOut()} className="bg-[#2b3139] px-3 py-1.5 rounded">خروج</button> : <button onClick={() => setShowLogin(true)} className="bg-[#0ecb81] text-black px-3 py-1.5 rounded font-bold">دخول</button>}
        </div>
      </header>

      <main className="max-w-md mx-auto">
        
        {/* الأرصدة */}
        {profile && (
          <div className="grid grid-cols-2 text-xs bg-[#181a20] p-3 border-b border-[#2b3139]">
            <div>
              <span className="text-[#848e9c] block mb-1">الرصيد المتاح</span>
              <div className="text-white font-bold">{formatNumber(profile.nil_balance, 0)} NIL</div>
              <div className="text-white font-bold">{formatNumber(profile.sdg_balance, 0)} SDG</div>
            </div>
            <div className="text-left border-r border-[#2b3139] pr-2">
              <span className="text-[#848e9c] block mb-1">المحجوز</span>
              <div className="text-[#f6465d] font-bold">{formatNumber(profile.nil_locked, 0)} NIL</div>
              <div className="text-[#f6465d] font-bold">{formatNumber(profile.sdg_locked, 0)} SDG</div>
            </div>
          </div>
        )}

        {/* الرسم البياني */}
        <div className="bg-[#181a20] border-b border-[#2b3139]">
           <div className="flex gap-2 p-2">
              {(['15m', '4h', '1d'] as const).map(t => (
                <button key={t} onClick={() => setTf(t)} className={`px-3 py-1 rounded text-xs font-bold ${tf === t ? 'bg-[#2b3139] text-white' : 'text-[#848e9c]'}`}>
                  {t === '15m' ? '15 دقيقة' : t === '4h' ? '4 ساعات' : 'يومي'}
                </button>
              ))}
           </div>
           <CandlestickChart timeframe={tf} />
        </div>

        {/* القسم الأوسط: دفتر الطلبات + نموذج التداول (جنباً إلى جنب مثل Binance) */}
        <div className="grid grid-cols-2 bg-[#181a20] border-b border-[#2b3139] h-[400px]">
          
          {/* العمود الأيمن: دفتر الطلبات */}
          <div className="border-l border-[#2b3139] flex flex-col h-full overflow-hidden">
            <div className="p-2 text-xs font-bold text-center text-white border-b border-[#2b3139] bg-[#1e2329]">دفتر الطلبات</div>
            <div className="flex-1 overflow-y-auto">
              <OrderBook />
            </div>
          </div>

          {/* العمود الأيسر: نموذج التداول */}
          <div className="p-2 overflow-y-auto bg-[#181a20]">
            {user ? <P2POrderForm userId={user.id} /> : <div className="text-center text-[#848e9c] mt-10 text-xs">سجل الدخول للتداول</div>}
          </div>
        </div>

        {/* التبويبات السفلية */}
        <div className="bg-[#181a20]">
          <div className="flex border-b border-[#2b3139] text-xs">
            <div className="flex-1 py-3 text-center font-bold text-white border-b-2 border-[#0ecb81]">الطلبات المفتوحة ({myOrders.length})</div>
          </div>
          <div className="p-2 h-[150px] overflow-y-auto">
            <table className="w-full text-[10px] text-right font-mono">
              <thead className="text-[#848e9c]">
                <tr><th className="pb-2">النوع</th><th>السعر</th><th>الكمية</th><th>إجراء</th></tr>
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
          </div>
        </div>
      </main>
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
    </div>
  )
}
