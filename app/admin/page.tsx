'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { formatNumber } from '@/lib/utils'

type AdminOrder = {
  id: string; user_id: string; side: 'buy' | 'sell'; price: number; amount: number;
  status: string; payment_ref: string | null; receipt_url: string | null;
  escrow_locked: boolean; created_at: string;
}

export default function AdminPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [deposits, setDeposits] = useState<any[]>([])
  const [withdrawals, setWithdrawals] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<any>(null)
  const [tab, setTab] = useState<'orders'|'deposits'|'withdrawals'>('orders')

  useEffect(() => {
    async function init() {
      const { data } = await supabase.auth.getSession()
      if (!data.session || data.session.user.email !== 'mb425262@gmail.com') {
        router.push('/')
        return
      }
      setSession(data.session)
      loadAllData(data.session.access_token)
    }
    init()
  }, [router])

  async function loadAllData(token: string) {
    setLoading(true)
    setError(null)
    try {
      // 1. جلب طلبات التداول
      const res = await fetch('/api/admin/review', { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setOrders(await res.json())

      // 2. جلب طلبات الإيداع
      const { data: d } = await supabase.from('deposits').select('*, profiles(username)').eq('status', 'pending')
      if (d) setDeposits(d)

      // 3. جلب طلبات السحب
      const { data: w } = await supabase.from('withdrawals').select('*, profiles(username)').eq('status', 'pending')
      if (w) setWithdrawals(w)

    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function actOrder(orderId: string, action: string) {
    if (!confirm(`تأكيد الإجراء: ${action}؟`)) return
    await fetch('/api/admin/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ orderId, action })
    })
    loadAllData(session.access_token)
  }

  async function approveDeposit(dep: any) {
    if (!confirm('موافقة على الإيداع وإضافة الرصيد؟')) return
    // تحديث حالة الطلب
    await supabase.from('deposits').update({ status: 'approved' }).eq('id', dep.id)
    // إضافة الرصيد للمستخدم
    await supabase.rpc('admin_add_balance', { target_email: dep.profiles.username, nils: 0, sdgs: dep.amount })
    alert('تمت الموافقة والإضافة')
    loadAllData(session.access_token)
  }

  if (loading && !orders.length && !deposits.length) return <div className="p-10 text-center text-white bg-slate-950 min-h-screen">جاري التحميل...</div>

  return (
    <div className="min-h-screen bg-slate-950 p-4 text-white" dir="rtl">
      <div className="flex justify-between mb-4">
        <h1 className="text-xl font-bold">لوحة تحكم الأدمن</h1>
        <button onClick={() => router.push('/')} className="bg-slate-800 px-3 py-1 rounded text-sm">عودة للمنصة</button>
      </div>

      {error && <div className="bg-red-900 p-2 rounded mb-4 text-sm">{error}</div>}

      {/* أزرار التبويب */}
      <div className="flex gap-2 mb-4 border-b border-slate-800 pb-2">
        <button onClick={() => setTab('orders')} className={`px-3 py-1 text-sm ${tab === 'orders' ? 'bg-slate-800 font-bold' : ''}`}>طلبات التداول</button>
        <button onClick={() => setTab('deposits')} className={`px-3 py-1 text-sm ${tab === 'deposits' ? 'bg-slate-800 font-bold' : ''}`}>الإيداعات ({deposits.length})</button>
        <button onClick={() => setTab('withdrawals')} className={`px-3 py-1 text-sm ${tab === 'withdrawals' ? 'bg-slate-800 font-bold' : ''}`}>السحوبات ({withdrawals.length})</button>
      </div>

      {/* محتوى التبويب */}
      {tab === 'orders' && (
        <div className="space-y-2">
           {orders.map(o => (
             <div key={o.id} className="bg-slate-900 p-3 rounded flex justify-between text-sm">
               <span>{o.side === 'buy' ? 'شراء' : 'بيع'} {o.amount} NIL @ {o.price}</span>
               <div className="flex gap-2">
                 <button onClick={() => actOrder(o.id, 'release')} className="bg-green-700 px-2 py-1 rounded text-xs">إفراج</button>
                 <button onClick={() => actOrder(o.id, 'cancel')} className="bg-red-700 px-2 py-1 rounded text-xs">إلغاء</button>
               </div>
             </div>
           ))}
        </div>
      )}

      {tab === 'deposits' && (
        <div className="space-y-2">
           {deposits.map(d => (
             <div key={d.id} className="bg-slate-900 p-3 rounded flex justify-between text-sm">
               <span>إيداع: {d.amount} SDG (مرجع: {d.receipt_ref})</span>
               <button onClick={() => approveDeposit(d)} className="bg-green-700 px-2 py-1 rounded text-xs">موافقة</button>
             </div>
           ))}
           {deposits.length === 0 && <p className="text-slate-500">لا توجد طلبات إيداع</p>}
        </div>
      )}

      {tab === 'withdrawals' && (
        <div className="space-y-2">
           {withdrawals.map(w => (
             <div key={w.id} className="bg-slate-900 p-3 rounded flex justify-between text-sm">
               <span>طلب سحب: {w.amount} SDG</span>
               <button className="bg-blue-700 px-2 py-1 rounded text-xs">إرسال التحويل</button>
             </div>
           ))}
           {withdrawals.length === 0 && <p className="text-slate-500">لا توجد طلبات سحب</p>}
        </div>
      )}
    </div>
  )
}
