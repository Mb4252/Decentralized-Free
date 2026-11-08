'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase, getUserProfile } from '@/lib/supabase'
import { formatNumber } from '@/lib/utils'
import CandlestickChart from './CandlestickChart'
import LoginModal from './LoginModal'
import DepositModal from './DepositModal'
import WithdrawModal from './WithdrawModal'
import P2PModal from './P2PModal'
import ToastHost, { toast } from './Toast'

export default function TradingDashboard() {
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [showLogin, setShowLogin] = useState(false)
  const [showDeposit, setShowDeposit] = useState(false)
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [showP2P, setShowP2P] = useState(false)
  
  const [tf, setTf] = useState<'15m' | '4h' | '1d'>('15m')
  const [livePrice, setLivePrice] = useState<number>(1290.00)

  const [myOrders, setMyOrders] = useState<any[]>([])
  const [bids, setBids] = useState<any[]>([])
  const [asks, setAsks] = useState<any[]>([])

  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [price, setPrice] = useState('')
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isAdmin = user?.email === 'mb425262@gmail.com'

  const colors = { bg: '#0b0e11', panel: '#181a20', border: '#2b3139', green: '#0ecb81', red: '#f6465d', text: '#eaecef', subtext: '#848e9c' }

  const loadData = async () => {
    const { data: orders } = await supabase.from('orders').select('*').eq('status', 'open')
    if (orders) {
      setBids(orders.filter(o => o.side === 'buy').sort((a, b) => b.price - a.price).slice(0, 5))
      setAsks(orders.filter(o => o.side === 'sell').sort((a, b) => a.price - b.price).slice(0, 5))
      if (user) setMyOrders(orders.filter(o => o.user_id === user.id))
      
      const bestAsk = orders.filter(o => o.side === 'sell').sort((a, b) => a.price - b.price)[0]
      const bestBid = orders.filter(o => o.side === 'buy').sort((a, b) => b.price - a.price)[0]
      if (bestAsk || bestBid) setLivePrice(bestAsk?.price || bestBid?.price)
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
    const ch = supabase.channel('live_data').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, loadData).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [user?.id])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return toast('سجل الدخول أولاً', 'error')
    const numPrice = Number(price)
    const numAmount = Number(amount)
    
    if (side === 'buy' && profile.sdg_balance < (numPrice * numAmount)) return toast('رصيد SDG غير كافٍ', 'error')
    if (side === 'sell' && profile.nil_balance < numAmount) return toast('رصيد NIL غير كافٍ', 'error')

    setSubmitting(true)
    try {
      const { error } = await supabase.from('orders').insert({ user_id: user.id, side, price: numPrice, amount: numAmount, status: 'open' })
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
    <div style={{ minHeight: '100vh', backgroundColor: colors.bg, color: colors.text, fontFamily: 'sans-serif', paddingBottom: '40px' }} dir="rtl">
      <ToastHost />
      
      <header style={{ borderBottom: `1px solid ${colors.border}`, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.panel }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '24px', height: '24px', backgroundColor: '#f3ba2f', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: 'black' }}>N</div>
          <h1 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>NIL<span style={{ color: colors.subtext }}>/</span>SDG</h1>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px' }}>
          {isAdmin && <Link href="/admin" style={{ color: '#facc15' }}>⚙️</Link>}
          <button onClick={() => setShowP2P(true)} style={{ backgroundColor: '#f3ba2f', color: 'black', border: 'none', padding: '6px 12px', borderRadius: '4px', fontWeight: 'bold' }}>P2P</button>
          {user ? (
            <button onClick={() => supabase.auth.signOut()} style={{ backgroundColor: colors.border, color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px' }}>خروج</button>
          ) : (
            <button onClick={() => setShowLogin(true)} style={{ backgroundColor: colors.green, color: 'black', border: 'none', padding: '6px 16px', borderRadius: '4px', fontWeight: 'bold' }}>دخول</button>
          )}
        </div>
      </header>

      <main style={{ maxWidth: '450px', margin: '0 auto' }}>
        
        {profile && (
          <div style={{ backgroundColor: colors.panel, padding: '12px', borderBottom: `1px solid ${colors.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '12px' }}>
              <div>
                <div style={{ color: colors.subtext, marginBottom: '4px' }}>الرصيد المتاح</div>
                <div style={{ color: 'white', fontWeight: 'bold', fontFamily: 'monospace' }}>{formatNumber(profile.nil_balance, 2)} NIL</div>
                <div style={{ color: 'white', fontWeight: 'bold', fontFamily: 'monospace' }}>{formatNumber(profile.sdg_balance, 2)} SDG</div>
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ color: colors.subtext, marginBottom: '4px' }}>المحجوز</div>
                <div style={{ color: colors.red, fontWeight: 'bold', fontFamily: 'monospace' }}>{formatNumber(profile.nil_locked, 2)} NIL</div>
                <div style={{ color: colors.red, fontWeight: 'bold', fontFamily: 'monospace' }}>{formatNumber(profile.sdg_locked, 2)} SDG</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setShowDeposit(true)} style={{ flex: 1, padding: '8px', backgroundColor: colors.border, color: 'white', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>إيداع</button>
              <button onClick={() => setShowWithdraw(true)} style={{ flex: 1, padding: '8px', backgroundColor: colors.border, color: 'white', border: 'none', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>سحب</button>
            </div>
          </div>
        )}

        <div style={{ backgroundColor: colors.panel, borderBottom: `1px solid ${colors.border}` }}>
           <div style={{ display: 'flex', gap: '16px', padding: '8px 12px', borderBottom: `1px solid ${colors.border}` }}>
              {(['15m', '4h', '1d'] as const).map(t => (
                <button key={t} onClick={() => setTf(t)} style={{ fontSize: '11px', fontWeight: 'bold', backgroundColor: 'transparent', border: 'none', color: tf === t ? colors.green : colors.subtext }}>
                  {t === '15m' ? '15 دقيقة' : t === '4h' ? '4 ساعات' : 'يومي'}
                </button>
              ))}
           </div>
           <div style={{ height: '240px', padding: '4px', position: 'relative' }}>
             <CandlestickChart timeframe={tf} livePrice={livePrice} />
             <div style={{ position: 'absolute', top: '10px', left: '10px', backgroundColor: 'rgba(24,26,32,0.8)', padding: '4px 8px', borderRadius: '4px', fontSize: '10px' }}>
               Live: <span style={{color: colors.green}}>{formatNumber(livePrice, 2)}</span>
             </div>
           </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'row', backgroundColor: colors.panel, borderBottom: `1px solid ${colors.border}`, height: '340px' }}>
          
          <div style={{ width: '55%', borderLeft: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '6px', fontSize: '11px', fontWeight: 'bold', color: colors.subtext, textAlign: 'center', borderBottom: `1px solid ${colors.border}` }}>دفتر الطلبات</div>
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontSize: '10px', fontFamily: 'monospace' }} dir="ltr">
              <div style={{ display: 'flex', justifyContent: 'space-between', color: colors.subtext, padding: '4px 8px' }}>
                <span style={{ width: '50%', textAlign: 'left' }}>Price(SDG)</span>
                <span style={{ width: '50%', textAlign: 'right' }}>Amt(NIL)</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column-reverse', flex: 1, overflow: 'hidden' }}>
                {asks.map((a, i) => (
                  <div key={i} style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', padding: '2px 8px' }}>
                    <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, backgroundColor: 'rgba(246, 70, 93, 0.15)', width: `${(a.amount / maxAmount) * 100}%` }} />
                    <span style={{ color: colors.red, zIndex: 1, width: '50%', textAlign: 'left' }}>{formatNumber(a.price, 2)}</span>
                    <span style={{ color: colors.text, zIndex: 1, width: '50%', textAlign: 'right' }}>{formatNumber(a.amount, 2)}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: '14px', fontWeight: 'bold', color: livePrice >= 1290 ? colors.green : colors.red, padding: '6px 0', borderTop: `1px solid ${colors.border}`, borderBottom: `1px solid ${colors.border}`, textAlign: 'center', margin: '4px 0', backgroundColor: colors.bg }}>
                {formatNumber(livePrice, 2)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                {bids.map((b, i) => (
                  <div key={i} style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', padding: '2px 8px' }}>
                    <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, backgroundColor: 'rgba(14, 203, 129, 0.15)', width: `${(b.amount / maxAmount) * 100}%` }} />
                    <span style={{ color: colors.green, zIndex: 1, width: '50%', textAlign: 'left' }}>{formatNumber(b.price, 2)}</span>
                    <span style={{ color: colors.text, zIndex: 1, width: '50%', textAlign: 'right' }}>{formatNumber(b.amount, 2)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ width: '45%', padding: '10px', backgroundColor: colors.panel, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button type="button" onClick={() => setSide('buy')} style={{ flex: 1, padding: '6px', fontSize: '11px', fontWeight: 'bold', borderRadius: '4px', border: 'none', backgroundColor: side === 'buy' ? colors.green : colors.border, color: side === 'buy' ? 'black' : colors.subtext }}>شراء</button>
              <button type="button" onClick={() => setSide('sell')} style={{ flex: 1, padding: '6px', fontSize: '11px', fontWeight: 'bold', borderRadius: '4px', border: 'none', backgroundColor: side === 'sell' ? colors.red : colors.border, color: side === 'sell' ? 'white' : colors.subtext }}>بيع</button>
            </div>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: colors.subtext }}>
                <span>السعر (SDG)</span>
              </div>
              <div style={{ position: 'relative' }}>
                <input type="number" step="any" required value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" dir="ltr"
                  style={{ width: '100%', backgroundColor: colors.border, color: 'white', border: '1px solid transparent', borderRadius: '4px', padding: '6px 8px', fontSize: '12px', outline: 'none', textAlign: 'left', boxSizing: 'border-box' }} />
                <span style={{ position: 'absolute', right: '8px', top: '6px', fontSize: '10px', color: colors.subtext }}>SDG</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: colors.subtext }}>
                <span>الكمية (NIL)</span>
              </div>
              <div style={{ position: 'relative' }}>
                <input type="number" step="any" required value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" dir="ltr"
                  style={{ width: '100%', backgroundColor: colors.border, color: 'white', border: '1px solid transparent', borderRadius: '4px', padding: '6px 8px', fontSize: '12px', outline: 'none', textAlign: 'left', boxSizing: 'border-box' }} />
                <span style={{ position: 'absolute', right: '8px', top: '6px', fontSize: '10px', color: colors.subtext }}>NIL</span>
              </div>
              <button type="submit" disabled={submitting} style={{ width: '100%', padding: '8px', marginTop: '8px', borderRadius: '4px', fontWeight: 'bold', fontSize: '11px', border: 'none', backgroundColor: side === 'buy' ? colors.green : colors.red, color: side === 'buy' ? 'black' : 'white' }}>
                {submitting ? 'جاري...' : side === 'buy' ? 'شراء NIL' : 'بيع NIL'}
              </button>
            </form>
          </div>
        </div>

        <div style={{ backgroundColor: colors.panel }}>
          <div style={{ display: 'flex', borderBottom: `1px solid ${colors.border}`, fontSize: '11px' }}>
            <div style={{ flex: 1, padding: '8px 0', textAlign: 'center', color: colors.text, fontWeight: 'bold', borderBottom: `2px solid ${colors.green}` }}>الطلبات المفتوحة ({myOrders.length})</div>
          </div>
          <div style={{ padding: '4px', height: '120px', overflowY: 'auto' }}>
             {myOrders.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: colors.subtext, fontSize: '10px' }}>لا توجد طلبات مفتوحة</div>
             ) : (
              <table style={{ width: '100%', fontSize: '10px', textAlign: 'right', fontFamily: 'monospace', borderCollapse: 'collapse' }}>
                <thead style={{ color: colors.subtext }}>
                  <tr><th style={{ padding: '4px', fontWeight: 'normal' }}>النوع</th><th style={{ fontWeight: 'normal' }}>السعر</th><th style={{ fontWeight: 'normal' }}>الكمية</th><th style={{ fontWeight: 'normal' }}>إجراء</th></tr>
                </thead>
                <tbody>
                  {myOrders.map(o => (
                    <tr key={o.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={{ padding: '4px', color: o.side === 'buy' ? colors.green : colors.red }}>{o.side === 'buy' ? 'شراء' : 'بيع'}</td>
                      <td style={{ color: colors.text }}>{formatNumber(o.price, 2)}</td>
                      <td style={{ color: colors.text }}>{formatNumber(o.amount, 2)}</td>
                      <td>
                        <button onClick={() => cancelOrder(o.id)} style={{ border: `1px solid ${colors.red}`, color: colors.red, backgroundColor: 'transparent', padding: '2px 8px', borderRadius: '2px', fontSize: '9px' }}>إلغاء</button>
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
      {showDeposit && <DepositModal onClose={() => setShowDeposit(false)} />}
      {showWithdraw && <WithdrawModal onClose={() => setShowWithdraw(false)} />}
      {showP2P && <P2PModal onClose={() => setShowP2P(false)} />}
    </div>
  )
}
