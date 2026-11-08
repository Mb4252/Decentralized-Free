'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { formatNumber } from '@/lib/utils'

export default function AdminPage() {
  const router = useRouter()
  const [deposits, setDeposits] = useState<any[]>([])
  const [withdrawals, setWithdrawals] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'deposits'|'withdrawals'|'orders'>('deposits')
  const [session, setSession] = useState<any>(null)

  useEffect(() => {
    async function init() {
      const { data } = await supabase.auth.getSession()
      if (!data.session || data.session.user.email !== 'mb425262@gmail.com') {
        router.push('/')
        return
      }
      setSession(data.session)
      loadData()
    }
    init()
  }, [router])

  async function loadData() {
    setLoading(true)
    // جلب الإيداعات المعلقة
    const { data: d } = await supabase.from('deposits').select('*, profiles(username)').eq('status', 'pending')
    if (d) setDeposits(d)
    
    // جلب السحوبات المعلقة
    const { data: w } = await supabase.from('withdrawals').select('*, profiles(username)').eq('status', 'pending')
    if (w) setWithdrawals(w)

    // جلب الطلبات المفتوحة
    const { data: o } = await supabase.from('orders').select('*, profiles(username)').eq('status', 'open')
    if (o) setOrders(o)

    setLoading(false)
  }

  async function approveDeposit(id: string) {
    if (!confirm('تأكيد إضافة الرصيد؟')) return
    const { error } = await supabase.rpc('approve_deposit', { deposit_id: id })
    if (error) alert(error.message)
    else { alert('تمت الموافقة'); loadData() }
  }

  async function approveWithdrawal(id: string) {
    if (!confirm('تأكيد خصم الرصيد؟ (بعد تحويل المبلغ فعلياً)')) return
    const { error } = await supabase.rpc('approve_withdrawal', { withdrawal_id: id })
    if (error) alert(error.message)
    else { alert('تمت الموافقة'); loadData() }
  }

  async function releaseOrder(orderId: string) {
    if (!confirm('الإفراج عن الأموال؟')) return
    // في النظام الحقيقي، هذه الدالة تُستدعى تلقائياً عند المطابقة، لكن الأدمن يمكنه التدخل يدوياً
    await supabase.from('orders').update({ status: 'released' }).eq('id', orderId)
    loadData()
  }

  async function cancelOrder(orderId: string) {
    if (!confirm('إلغاء الطلب وإرجاع الأموال؟')) return
    const { error } = await supabase.rpc('cancel_order_and_refund', { order_id: orderId })
    if (error) alert(error.message)
    else { alert('تم الإلغاء والإرجاع'); loadData() }
  }

  if (loading) return <div className="p-10 text-center text-white bg-slate-950 min-h-screen">جاري التحميل...</div>

  return (
    <div className="min-h-screen bg-slate-950 p-4 text-white" dir="rtl">
      <div className="flex justify-between mb-6">
        <h1 className="text-xl font-bold">لوحة تحكم الأدمن</h1>
        <button onClick={() => router.push('/')} className="bg-slate-800 px-4 py-1 rounded text-sm hover:bg-slate-700">عودة للمنصة</button>
      </div>

      <div className="flex gap-2 mb-6 border-b border-slate-800 pb-2">
        <button onClick={() => setTab('deposits')} className={`px-4 py-2 text-sm rounded ${tab === 'deposits' ? 'bg-green-700 font-bold' : 'hover:bg-slate-800'}`}>الإيداعات ({deposits.length})</button>
        <button onClick={() => setTab('withdrawals')} className={`px-4 py-2 text-sm rounded ${tab === 'withdrawals' ? 'bg-red-700 font-bold' : 'hover:bg-slate-800'}`}>السحوبات ({withdrawals.length})</button>
        <button onClick={() => setTab('orders')} className={`px-4 py-2 text-sm rounded ${tab === 'orders' ? 'bg-blue-700 font-bold' : 'hover:bg-slate-800'}`}>الطلبات المفتوحة ({orders.length})</button>
      </div>

      {tab === 'deposits' && (
        <div className="space-y-3">
           {deposits.map(d => (
             <div key={d.id} className="bg-slate-900 p-4 rounded-lg flex justify-between items-center border border-slate-800">
               <div>
                 <p className="text-sm font-bold">إيداع: {d.amount} SDG</p>
                 <p className="text-xs text-slate-400">المستخدم: {d.profiles?.username || 'غير معروف'} | مرجع: {d.receipt_ref}</p>
               </div>
               <button onClick={() => approveDeposit(d.id)} className="bg-green-600 hover:bg-green-500 px-4 py-2 rounded text-sm font-bold">موافقة وإضافة</button>
             </div>
           ))}
           {deposits.length === 0 && <p className="text-slate-500 text-center py-10">لا توجد طلبات إيداع معلقة</p>}
        </div>
      )}

      {tab === 'withdrawals' && (
        <div className="space-y-3">
           {withdrawals.map(w => (
             <div key={w.id} className="bg-slate-900 p-4 rounded-lg flex justify-between items-center border border-slate-800">
               <div>
                 <p className="text-sm font-bold">طلب سحب: {w.amount} SDG</p>
                 <p className="text-xs text-slate-400">المستخدم: {w.profiles?.username || 'غير معروف'}</p>
               </div>
               <button onClick={() => approveWithdrawal(w.id)} className="bg-red-600 hover:bg-red-500 px-4 py-2 rounded text-sm font-bold">خصم وتحويل يدوي</button>
             </div>
           ))}
           {withdrawals.length === 0 && <p className="text-slate-500 text-center py-10">لا توجد طلبات سحب معلقة</p>}
        </div>
      )}

      {tab === 'orders' && (
        <div className="space-y-3">
           {orders.map(o => (
             <div key={o.id} className="bg-slate-900 p-4 rounded-lg flex justify-between items-center border border-slate-800">
               <div>
                 <p className="text-sm font-bold">{o.side === 'buy' ? 'شراء' : 'بيع'} {o.amount} NIL @ {formatNumber(o.price)} SDG</p>
                 <p className="text-xs text-slate-400">المستخدم: {o.profiles?.username || 'غير معروف'}</p>
               </div>
               <div className="flex gap-2">
                 <button onClick={() => releaseOrder(o.id)} className="bg-green-700 px-3 py-1 rounded text-xs hover:bg-green-600">إفراج</button>
                 <button onClick={() => cancelOrder(o.id)} className="bg-red-700 px-3 py-1 rounded text-xs hover:bg-red-600">إلغاء</button>
               </div>
             </div>
           ))}
           {orders.length === 0 && <p className="text-slate-500 text-center py-10">لا توجد طلبات مفتوحة</p>}
        </div>
      )}
    </div>
  )
}
