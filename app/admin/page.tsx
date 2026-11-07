'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { formatNumber } from '@/lib/utils'

type AdminOrder = {
  id: string
  user_id: string
  side: 'buy' | 'sell'
  price: number
  amount: number
  status: string
  payment_ref: string | null
  receipt_url: string | null
  escrow_locked: boolean
  created_at: string
}

export default function AdminPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<any>(null)

  useEffect(() => {
    async function init() {
      const { data } = await supabase.auth.getSession()
      
      // التحقق المباشر من البريد الإلكتروني (بدون استعلام قاعدة البيانات)
      if (!data.session || data.session.user.email !== 'mb425262@gmail.com') {
        router.push('/')
        return
      }
      
      setSession(data.session)
      load(data.session.access_token)
    }
    init()
  }, [router])

  async function load(token: string) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/review', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      setOrders(await res.json())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function act(orderId: string, action: 'release' | 'cancel' | 'mark_paid') {
    if (!confirm(`تأكيد الإجراء: ${action}؟`)) return
    if (!session) return
    const res = await fetch('/api/admin/review', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ orderId, action })
    })
    if (res.ok) load(session.access_token)
    else alert('فشل الإجراء')
  }

  if (loading && !orders.length) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400">
        جاري التحقق من صلاحيات الأدمن...
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">⚙️ لوحة الأدمن</h1>
        <div className="flex gap-2">
          <button onClick={() => router.push('/')}
            className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded text-white">
            ← العودة للمنصة
          </button>
          <button onClick={() => session && load(session.access_token)}
            className="text-xs bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded font-bold text-white">
            🔄 تحديث
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        مسجّل الدخول كأدمن: <span className="text-amber-400">{session?.user?.email}</span>
      </p>

      {error && <p className="text-red-400 text-sm bg-red-950/40 p-2 rounded">خطأ: {error}</p>}

      <div className="space-y-2">
        {orders.map(o => (
          <div key={o.id} className="bg-slate-900 rounded-lg p-3 grid md:grid-cols-[1fr_auto] gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`px-2 py-0.5 rounded text-xs font-bold text-white ${
                  o.side === 'buy' ? 'bg-green-600' : 'bg-red-600'
                }`}>
                  {o.side === 'buy' ? 'شراء' : 'بيع'}
                </span>
                <span className="font-mono text-white">{formatNumber(o.amount)} NIL</span>
                <span className="text-slate-500">@</span>
                <span className="font-mono text-blue-400">{formatNumber(o.price)} SDG</span>
                <span className={`text-xs px-2 py-0.5 rounded text-white ${
                  o.status === 'open' ? 'bg-yellow-700' :
                  o.status === 'paid' ? 'bg-blue-700' :
                  o.status === 'released' ? 'bg-green-700' : 'bg-slate-700'
                }`}>{o.status}</span>
              </div>
              <div className="text-xs text-slate-400">
                مرجع: {o.payment_ref ?? '—'} · {new Date(o.created_at).toLocaleString('ar-EG')}
              </div>
              {o.receipt_url && (
                <a href={o.receipt_url} target="_blank" rel="noreferrer"
                  className="text-xs text-blue-400 underline inline-block">
                  عرض الإيصال ↗
                </a>
              )}
            </div>
            <div className="flex flex-wrap gap-1 self-center">
              <button onClick={() => act(o.id, 'mark_paid')}
                className="text-xs bg-blue-700 hover:bg-blue-600 px-2.5 py-1.5 rounded text-white">
                تأكيد الدفع
              </button>
              <button onClick={() => act(o.id, 'release')}
                className="text-xs bg-green-700 hover:bg-green-600 px-2.5 py-1.5 rounded text-white">
                الإفراج
              </button>
              <button onClick={() => act(o.id, 'cancel')}
                className="text-xs bg-red-700 hover:bg-red-600 px-2.5 py-1.5 rounded text-white">
                إلغاء
              </button>
            </div>
          </div>
        ))}
        {!orders.length && !loading && (
          <p className="text-slate-500 text-center py-8">لا توجد طلبات حالياً.</p>
        )}
      </div>
    </div>
  )
}
