'use client'
import { useState } from 'react'
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
  const [key, setKey] = useState('')
  const [orders, setOrders] = useState<AdminOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/review', {
        headers: { 'x-admin-key': key }
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
    const res = await fetch('/api/admin/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': key },
      body: JSON.stringify({ orderId, action })
    })
    if (res.ok) load()
    else alert('فشل الإجراء')
  }

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <h1 className="text-xl font-bold">لوحة الأدمن — مراجعة الطلبات</h1>

      <div className="flex gap-2">
        <input type="password" placeholder="مفتاح الأدمن"
          value={key} onChange={e => setKey(e.target.value)}
          className="p-2 bg-slate-800 rounded flex-1" />
        <button onClick={load} disabled={loading || !key}
          className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded font-bold disabled:opacity-50">
          {loading ? '...' : 'جلب الطلبات'}
        </button>
      </div>

      {error && <p className="text-red-400 text-sm">خطأ: {error}</p>}

      <div className="space-y-2">
        {orders.map(o => (
          <div key={o.id} className="bg-slate-900 rounded-lg p-3 grid md:grid-cols-[1fr_auto] gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                  o.side === 'buy' ? 'bg-green-600' : 'bg-red-600'
                }`}>
                  {o.side === 'buy' ? 'شراء' : 'بيع'}
                </span>
                <span className="font-mono">{formatNumber(o.amount)} NIL</span>
                <span className="text-slate-500">@</span>
                <span className="font-mono text-blue-400">{formatNumber(o.price)} SDG</span>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  o.status === 'open' ? 'bg-yellow-700' :
                  o.status === 'paid' ? 'bg-blue-700' :
                  o.status === 'released' ? 'bg-green-700' : 'bg-slate-700'
                }`}>{o.status}</span>
                {o.escrow_locked && <span className="text-xs text-orange-400">🔒 escrow</span>}
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
                className="text-xs bg-blue-700 hover:bg-blue-600 px-2.5 py-1.5 rounded">
                تأكيد الدفع
              </button>
              <button onClick={() => act(o.id, 'release')}
                className="text-xs bg-green-700 hover:bg-green-600 px-2.5 py-1.5 rounded">
                الإفراج عن العملات
              </button>
              <button onClick={() => act(o.id, 'cancel')}
                className="text-xs bg-red-700 hover:bg-red-600 px-2.5 py-1.5 rounded">
                إلغاء
              </button>
            </div>
          </div>
        ))}
        {!orders.length && !loading && (
          <p className="text-slate-500 text-center py-8">لا توجد طلبات. أدخل المفتاح ثم اضغط جلب.</p>
        )}
      </div>
    </div>
  )
}
