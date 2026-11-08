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
    <div className="min-h-screen bg-[#0b0e11] text-[#eaecef] font-sans pb-10 overflow-x-hidden selection:bg-[#0ecb81] selection:text-black" dir="rtl">
      <ToastHost />
      
      {/* 1. الشريط العلوي (Header) - مشابه لباينانس */}
      <header className="border-b border-[#2b3139] px-4 py-2 flex justify-between items-center bg-[#181a20] sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-white tracking-wide">NIL<span className="text-[#848e9c]">/</span>SDG</h1>
          <div className="hidden sm:flex gap-2 text-[10px] text-[#848e9c]">
             {/* يمكن إضافة مؤشرات هنا لاحقاً */}
          </div>
        </div>
        <div className="flex gap-2 items-center text-xs">
          {isAdmin && <Link href="/admin" className="text-yellow-500 hover:text-yellow-400">⚙️</Link>}
          {user ? (
            <button onClick={() => supabase.auth.signOut()} className="bg-[#2b3139] hover:bg-[#3c434d] transition-colors px-3 py-1.5 rounded text-white">
              خروج
            </button>
          ) : (
            <button onClick={() => setShowLogin(true)} className="bg-[#0ecb81] hover:bg-[#0bda8a] transition-colors text-black px-4 py-1.5 rounded font-bold">
              تسجيل الدخول
            </button>
          )}
        </div>
      </header>

      <main className="max-w-md mx-auto relative">
        
        {/* 2. الأرصدة (Balances) - تصميم أنظف */}
        {profile && (
          <div className="flex justify-between text-[11px] bg-[#181a20] p-3 border-b border-[#2b3139]">
            <div className="flex flex-col gap-1">
              <span className="text-[#848e9c]">الرصيد المتاح</span>
              <div className="flex gap-3 font-mono">
                <span className="text-white font-bold">{formatNumber(profile.nil_balance, 0)} <span className="text-[9px] text-[#848e9c]">NIL</span></span>
                <span className="text-white font-bold">{formatNumber(profile.sdg_balance, 0)} <span className="text-[9px] text-[#848e9c]">SDG</span></span>
              </div>
            </div>
            <div className="flex flex-col gap-1 text-left">
              <span className="text-[#848e9c]">المحجوز</span>
              <div className="flex gap-3 font-mono">
                <span className="text-[#f6465d] font-bold">{formatNumber(profile.nil_locked, 0)} <span className="text-[9px] text-[#848e9c]">NIL</span></span>
                <span className="text-[#f6465d] font-bold">{formatNumber(profile.sdg_locked, 0)} <span className="text-[9px] text-[#848e9c]">SDG</span></span>
              </div>
            </div>
          </div>
        )}

        {/* 3. الرسم البياني (Chart) */}
        <div className="bg-[#181a20] border-b border-[#2b3139]">
           <div className="flex gap-4 px-3 py-2 border-b border-[#2b3139]/50">
              {(['15m', '4h', '1d'] as const).map(t => (
                <button key={t} onClick={() => setTf(t)} className={`text-[11px] font-medium transition-colors ${tf === t ? 'text-[#0ecb81]' : 'text-[#848e9c] hover:text-white'}`}>
                  {t === '15m' ? '15 دقيقة' : t === '4h' ? '4 ساعات' : 'يومي'}
                </button>
              ))}
           </div>
           <div className="h-[240px] p-1">
             <CandlestickChart timeframe={tf} />
           </div>
        </div>

        {/* 4. القسم الأوسط: دفتر الطلبات ونموذج التداول */}
        <div className="flex flex-row bg-[#181a20] border-b border-[#2b3139] h-[340px]">
          
          {/* دفتر الطلبات (Order Book) */}
          <div className="w-[55%] border-l border-[#2b3139] flex flex-col h-full overflow-hidden">
            <div className="p-1.5 text-[11px] font-medium text-[#848e9c] text-center border-b border-[#2b3139]">دفتر الطلبات</div>
            
            <div className="flex flex-col h-full text-[10px] font-mono w-full" dir="ltr">
              <div className="flex justify-between text-[#848e9c] px-2 py-1">
                <span className="w-1/2 text-left">Price(SDG)</span>
                <span className="w-1/2 text-right">Amt(NIL)</span>
              </div>

              {/* Asks (Sell) */}
              <div className="flex flex-col-reverse flex-1 overflow-hidden">
                {asks.map((a, i) => (
                  <div key={i} className="relative flex justify-between py-[2px] px-2 group hover:bg-[#2b3139]/30 cursor-pointer">
                    <div className="absolute inset-y-0 right-0 bg-[#f6465d]/15 transition-all duration-300" style={{ width: `${(a.amount / maxAmount) * 100}%` }} />
                    <span className="text-[#f6465d] z-10 w-1/2 text-left">{formatNumber(a.price, 0)}</span>
                    <span className="text-[#eaecef] z-10 w-1/2 text-right">{formatNumber(a.amount, 0)}</span>
                  </div>
                ))}
              </div>

              {/* Current Price */}
              <div className="text-sm font-bold text-[#0ecb81] py-1.5 border-y border-[#2b3139] text-center my-1 bg-[#181a20] flex items-center justify-center gap-1">
                <span>{formatNumber(asks[0]?.price || bids[0]?.price || 0, 0)}</span>
                <span className="text-[9px] text-[#848e9c]">≈ {formatNumber(asks[0]?.price || bids[0]?.price || 0, 0)}</span>
              </div>

              {/* Bids (Buy) */}
              <div className="flex flex-col flex-1 overflow-hidden">
                {bids.map((b, i) => (
                  <div key={i} className="relative flex justify-between py-[2px] px-2 group hover:bg-[#2b3139]/30 cursor-pointer">
                    <div className="absolute inset-y-0 right-0 bg-[#0ecb81]/15 transition-all duration-300" style={{ width: `${(b.amount / maxAmount) * 100}%` }} />
                    <span className="text-[#0ecb81] z-10 w-1/2 text-left">{formatNumber(b.price, 0)}</span>
                    <span className="text-[#eaecef] z-10 w-1/2 text-right">{formatNumber(b.amount, 0)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* نموذج التداول (Trade Form) */}
          <div className="w-[45%] p-2.5 bg-[#181a20] flex flex-col gap-2">
            <div className="flex gap-1 mb-1">
              <button type="button" onClick={() => setSide('buy')} className={`flex-1 py-1.5 text-[11px] font-bold rounded-sm transition-colors ${side === 'buy' ? 'bg-[#0ecb81] text-black' : 'bg-[#2b3139] text-[#848e9c] hover:text-white'}`}>شراء</button>
              <button type="button" onClick={() => setSide('sell')} className={`flex-1 py-1.5 text-[11px] font-bold rounded-sm transition-colors ${side === 'sell' ? 'bg-[#f6465d] text-white' : 'bg-[#2b3139] text-[#848e9c] hover:text-white'}`}>بيع</button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-2">
              <div className="flex justify-between text-[10px] text-[#848e9c]">
                <span>السعر (SDG)</span>
                <span>متاح: 0.00</span>
              </div>
              <div className="relative">
                <input 
                  type="number" required value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" 
                  className="w-full bg-[#2b3139] text-white border border-transparent focus:border-[#0ecb81] rounded-sm px-2 py-1.5 text-xs outline-none text-left font-mono transition-colors" dir="ltr"
                />
                <span className="absolute right-2 top-1.5 text-[10px] text-[#848e9c]">SDG</span>
              </div>

              <div className="flex justify-between text-[10px] text-[#848e9c] mt-1">
                <span>الكمية (NIL)</span>
                <span>متاح: 0.00</span>
              </div>
              <div className="relative">
                <input 
                  type="number" required value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" 
                  className="w-full bg-[#2b3139] text-white border border-transparent focus:border-[#0ecb81] rounded-sm px-2 py-1.5 text-xs outline-none text-left font-mono transition-colors" dir="ltr"
                />
                <span className="absolute right-2 top-1.5 text-[10px] text-[#848e9c]">NIL</span>
              </div>

              <button type="submit" disabled={submitting} className={`w-full py-2 mt-2 rounded-sm font-bold text-[11px] transition-colors ${side === 'buy' ? 'bg-[#0ecb81] hover:bg-[#0bda8a] text-black' : 'bg-[#f6465d] hover:bg-[#ff5c72] text-white'}`}>
                {submitting ? 'جاري التنفيذ...' : side === 'buy' ? 'شراء NIL' : 'بيع NIL'}
              </button>
            </form>
          </div>
        </div>

        {/* 5. التبويبات السفلية (Open Orders) */}
        <div className="bg-[#181a20] min-h-[150px]">
          <div className="flex border-b border-[#2b3139] text-[11px]">
            <div className="flex-1 py-2 text-center text-[#eaecef] font-bold border-b-2 border-[#0ecb81]">الطلبات المفتوحة ({myOrders.length})</div>
            {/* يمكن إضافة تبويب سجل الطلبات لاحقاً */}
          </div>
          <div className="p-1 h-[120px] overflow-y-auto">
             {myOrders.length === 0 ? (
                <div className="flex items-center justify-center h-full text-[#848e9c] text-[10px]">لا توجد طلبات مفتوحة</div>
             ) : (
              <table className="w-full text-[10px] text-right font-mono">
                <thead className="text-[#848e9c] bg-[#181a20] sticky top-0">
                  <tr><th className="pb-1 font-normal text-right pl-2">النوع</th><th className="font-normal text-right">السعر</th><th className="font-normal text-right">الكمية</th><th className="font-normal text-center">إجراء</th></tr>
                </thead>
                <tbody>
                  {myOrders.map(o => (
                    <tr key={o.id} className="border-b border-[#2b3139]/30 hover:bg-[#2b3139]/20">
                      <td className={`py-1 pl-2 ${o.side === 'buy' ? 'text-[#0ecb81]' : 'text-[#f6465d]'}`}>{o.side === 'buy' ? 'شراء' : 'بيع'}</td>
                      <td className="text-[#eaecef]">{formatNumber(o.price, 0)}</td>
                      <td className="text-[#eaecef]">{formatNumber(o.amount, 0)}</td>
                      <td className="text-center py-1">
                        <button onClick={() => cancelOrder(o.id)} className="border border-[#f6465d]/50 text-[#f6465d] hover:bg-[#f6465d] hover:text-white transition-colors px-2 py-0.5 rounded-sm text-[9px]">إلغاء</button>
                      </td>
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
