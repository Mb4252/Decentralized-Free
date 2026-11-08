'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase, getUserProfile } from '@/lib/supabase'
import { formatNumber } from '@/lib/utils'
import CandlestickChart from './CandlestickChart'
import LoginModal from './LoginModal'
import ToastHost, { toast } from './Toast'

export default function TradingDashboard() {
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [showLogin, setShowLogin] = useState(false)
  const [tf, setTf] = useState<'15m' | '4h' | '1d'>('15m')
  const [myOrders, setMyOrders] = useState<any[]>([])
  
  // حالة دفتر الطلبات
  const [bids, setBids] = useState<any[]>([])
  const [asks, setAsks] = useState<any[]>([])

  // حالة نموذج التداول
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [price, setPrice] = useState('')
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isAdmin = user?.email === 'mb425262@gmail.com'

  const loadData = async () => {
    const { data: orders } = await supabase.from('orders').select('*').eq('status', 'open')
    if (orders) {
      setBids(orders.filter(o => o.side === 'buy').sort((a, b) => b.price - a.price).slice(0, 5))
      setAsks(orders.filter(o => o.side === 'sell').sort((a, b) => a.price - b.price).slice(0, 5))
      if (user) setMyOrders(orders.filter(o => o.user_id === user.id))
    }
  }

  useEffect(() => {
    async function init() {
      const { data } = await supabase.auth.getUser()
      setUser(data.user)
      if (data.user) setProfile(await getUserProfile())
      loadData()
    }
    init()

    const ch = supabase.channel('live_data')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, loadData)
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [user?.id])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return toast('سجل الدخول أولاً', 'error')
    
    const numPrice = Number(price)
    const numAmount = Number(amount)
    if (numPrice <= 0 || numAmount <= 0) return toast('أدخل سعر وكمية صحيحة', 'error')

    setSubmitting(true)
    try {
      const { error } = await supabase.from('orders').insert({ 
        user_id: user.id, side, price: numPrice, amount: numAmount, status: 'open' 
      })
      if (error) throw error
      toast('تم إرسال الطلب', 'success')
      setPrice(''); setAmount('')
      setProfile(await getUserProfile())
      loadData()
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  async function cancelOrder(id: string) {
    if (!confirm('إلغاء الطلب؟')) return
    await supabase.from('orders').update({ status: 'cancelled' }).eq('id', id)
    toast('تم الإلغاء', 'success')
    loadData()
  }

  const maxAmount = Math.max(...bids.map(b => b.amount), ...asks.map(a => a.amount), 1)

  return (
    // إصلاح شامل للخلفية ومنع التمرير الأفقي
    <div className="min-h-screen bg-[#0b0e11] text-[#eaecef] font-sans pb-10 overflow-x-hidden" dir="rtl">
      <ToastHost />
      
      {/* الشريط العلوي */}
      <header className="border-b border-[#2b3139] px-3 py-2 flex justify-between items-center bg-[#181a20]">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-bold">NIL/SDG</h1>
        </div>
        <div className="flex gap-2 items-center text-xs">
          {isAdmin && <Link href="/admin" className="text-yellow-500">⚙️</Link>}
          {user ? <button onClick={() => supabase.auth.signOut()} className="bg-[#2b3139] px-2 py-1 rounded">خروج</button> : <button onClick={() => setShowLogin(true)} className="bg-[#0ecb81] text-black px-3 py-1 rounded font-bold">دخول</button>}
        </div>
      </header>

      <main className="max-w-md mx-auto">
        
        {/* الأرصدة - تم تصغيرها لمنع تمدد الشاشة */}
        {profile && (
          <div className="flex justify-between text-[10px] bg-[#181a20] p-2 border-b border-[#2b3139]">
            <div>
              <span className="text-[#848e9c] block">الرصيد المتاح</span>
              <div className="text-white font-bold">{formatNumber(profile.nil_balance, 0)} NIL</div>
              <div className="text-white font-bold">{formatNumber(profile.sdg_balance, 0)} SDG</div>
            </div>
            <div className="text-left">
              <span className="text-[#848e9c] block">المحجوز</span>
              <div className="text-[#f6465d] font-bold">{formatNumber(profile.nil_locked, 0)} NIL</div>
              <div className="text-[#f6465d] font-bold">{formatNumber(profile.sdg_locked, 0)} SDG</div>
            </div>
          </div>
        )}

        {/* الرسم البياني */}
        <div className="bg-[#181a20] border-b border-[#2b3139]">
           <div className="flex gap-2 p-1.5">
              {(['15m', '4h', '1d'] as const).map(t => (
                <button key={t} onClick={() => setTf(t)} className={`px-2 py-0.5 rounded text-[10px] font-bold ${tf === t ? 'bg-[#2b3139] text-white' : 'text-[#848e9c]'}`}>
                  {t === '15m' ? '15 دقيقة' : t === '4h' ? '4 ساعات' : 'يومي'}
                </button>
              ))}
           </div>
           <div className="h-[220px]">
             <CandlestickChart timeframe={tf} />
           </div>
        </div>

        {/* القسم الأوسط: التقسيم الصارم (الطلبات يمين، الشراء يسار) */}
        <div className="flex flex-row bg-[#181a20] border-b border-[#2b3139] h-[320px]">
          
          {/* يمين: دفتر الطلبات (عرض 50%) */}
          <div className="w-1/2 border-l border-[#2b3139] flex flex-col h-full overflow-hidden">
            <div className="p-1 text-[10px] font-bold text-center text-white border-b border-[#2b3139] bg-[#1e2329]">دفتر الطلبات</div>
            
            <div className="flex flex-col h-full text-[9px] font-mono w-full" dir="ltr">
              <div className="flex justify-between text-[#848e9c] px-1 py-1 border-b border-[#2b3139]">
                <span className="w-1/2 text-left">Price</span>
                <span className="w-1/2 text-right">Amt</span>
              </div>

              {/* طلبات البيع (حمراء) */}
              <div className="flex flex-col-reverse flex-1 overflow-hidden">
                {asks.map((a, i) => (
                  <div key={i} className="relative flex justify-between py-1 px-1">
                    <div className="absolute inset-y-0 right-0 bg-[#f6465d]/15" style={{ width: `${(a.amount / maxAmount) * 100}%` }} />
                    <span className="text-[#f6465d] z-10 w-1/2 text-left">{formatNumber(a.price, 0)}</span>
                    <span className="text-white z-10 w-1/2 text-right">{formatNumber(a.amount, 0)}</span>
                  </div>
                ))}
              </div>

              {/* السعر الحالي */}
              <div className="text-xs font-bold text-[#0ecb81] py-1 border-y border-[#2b3139] text-center my-0.5 bg-[#0b0e11]">
                {formatNumber(asks[0]?.price || bids[0]?.price || 0, 0)}
              </div>

              {/* طلبات الشراء (خضراء) */}
              <div className="flex flex-col flex-1 overflow-hidden">
                {bids.map((b, i) => (
                  <div key={i} className="relative flex justify-between py-1 px-1">
                    <div className="absolute inset-y-0 right-0 bg-[#0ecb81]/15" style={{ width: `${(b.amount / maxAmount) * 100}%` }} />
                    <span className="text-[#0ecb81] z-10 w-1/2 text-left">{formatNumber(b.price, 0)}</span>
                    <span className="text-white z-10 w-1/2 text-right">{formatNumber(b.amount, 0)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* يسار: نموذج التداول (عرض 50%) */}
          <div className="w-1/2 p-2 overflow-y-auto bg-[#181a20]">
            <form onSubmit={handleSubmit} className="flex flex-col gap-2">
              {/* أزرار التبديل - الشراء أخضر والبيع أحمر */}
              <div className="flex bg-[#2b3139] rounded p-0.5">
                <button type="button" onClick={() => setSide('buy')} className={`flex-1 py-1 text-[10px] font-bold rounded ${side === 'buy' ? 'bg-[#0ecb81] text-black' : 'text-[#848e9c]'}`}>شراء</button>
                <button type="button" onClick={() => setSide('sell')} className={`flex-1 py-1 text-[10px] font-bold rounded ${side === 'sell' ? 'bg-[#f6465d] text-white' : 'text-[#848e9c]'}`}>بيع</button>
              </div>

              {/* السعر */}
              <div>
                <div className="text-[9px] text-[#848e9c] mb-0.5">السعر (SDG)</div>
                <input 
                  type="number" required value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" 
                  className="w-full bg-[#2b3139] text-white border-none rounded px-1.5 py-1 text-[10px] outline-none text-right font-mono" 
                />
              </div>

              {/* الكمية */}
              <div>
                <div className="text-[9px] text-[#848e9c] mb-0.5">الكمية (NIL)</div>
                <input 
                  type="number" required value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" 
                  className="w-full bg-[#2b3139] text-white border-none rounded px-1.5 py-1 text-[10px] outline-none text-right font-mono" 
                />
              </div>

              {/* زر الإرسال - يتلون حسب النوع */}
              <button type="submit" disabled={submitting} className={`w-full py-1.5 mt-1 rounded font-bold text-[10px] ${side === 'buy' ? 'bg-[#0ecb81] text-black' : 'bg-[#f6465d] text-white'}`}>
                {submitting ? 'جاري...' : side === 'buy' ? 'شراء NIL' : 'بيع NIL'}
              </button>
            </form>
          </div>
        </div>

        {/* التبويبات السفلية */}
        <div className="bg-[#181a20]">
          <div className="flex border-b border-[#2b3139] text-xs">
            <div className="flex-1 py-2 text-center font-bold text-white border-b-2 border-[#0ecb81]">الطلبات المفتوحة ({myOrders.length})</div>
          </div>
          <div className="p-2 h-[120px] overflow-y-auto">
            <table className="w-full text-[10px] text-right font-mono">
              <thead className="text-[#848e9c]">
                <tr><th className="pb-1">النوع</th><th>السعر</th><th>الكمية</th><th>إجراء</th></tr>
              </thead>
              <tbody>
                {myOrders.map(o => (
                  <tr key={o.id} className="border-t border-[#2b3139]/50">
                    <td className={o.side === 'buy' ? 'text-[#0ecb81]' : 'text-[#f6465d]'}>{o.side === 'buy' ? 'شراء' : 'بيع'}</td>
                    <td className="text-white">{formatNumber(o.price, 0)}</td>
                    <td className="text-white">{formatNumber(o.amount, 0)}</td>
                    <td className="text-left py-1">
                      <button onClick={() => cancelOrder(o.id)} className="border border-[#f6465d] text-[#f6465d] px-1.5 py-0.5 rounded text-[9px]">إلغاء</button>
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
