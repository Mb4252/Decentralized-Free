'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from './Toast'

export default function P2POrderForm({ userId }: { userId: string }) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [price, setPrice] = useState('')
  const [amount, setAmount] = useState('')
  const [paymentRef, setPaymentRef] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function uploadReceipt(): Promise<string | null> {
    if (!file) return null
    const fileName = `${userId}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`
    const { error } = await supabase.storage.from('receipts').upload(fileName, file, {
      cacheControl: '3600',
      upsert: false
    })
    if (error) throw error
    const { data } = supabase.storage.from('receipts').getPublicUrl(fileName)
    return data.publicUrl
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const receiptUrl = await uploadReceipt()

      const { error } = await supabase.from('orders').insert({
        user_id: userId,
        side,
        price: Number(price),
        amount: Number(amount),
        payment_ref: paymentRef || null,
        receipt_url: receiptUrl,
        status: 'open',
        escrow_locked: side === 'sell'
      })

      if (error) throw error
      toast('تم إرسال الطلب بنجاح', 'success')
      setPrice('')
      setAmount('')
      setPaymentRef('')
      setFile(null)
    } catch (err: any) {
      toast(err.message ?? 'فشل الإرسال', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-slate-900 rounded-lg p-4 space-y-3">
      <h3 className="font-bold text-sm">طلب P2P جديد</h3>

      <div className="flex gap-2">
        <button type="button" onClick={() => setSide('buy')}
          className={`flex-1 py-2 rounded font-bold transition ${
            side === 'buy' ? 'bg-green-600 text-white' : 'bg-slate-800 text-slate-400'
          }`}>
          شراء NIL
        </button>
        <button type="button" onClick={() => setSide('sell')}
          className={`flex-1 py-2 rounded font-bold transition ${
            side === 'sell' ? 'bg-red-600 text-white' : 'bg-slate-800 text-slate-400'
          }`}>
          بيع NIL
        </button>
      </div>

      <input type="number" step="0.01" min="0.01" required
        placeholder="السعر (SDG لكل NIL)"
        value={price} onChange={e => setPrice(e.target.value)}
        className="w-full p-2.5 bg-slate-800 rounded focus:outline-none focus:ring-2 focus:ring-blue-600" />

      <input type="number" step="0.01" min="0.01" required
        placeholder="الكمية (NIL)"
        value={amount} onChange={e => setAmount(e.target.value)}
        className="w-full p-2.5 bg-slate-800 rounded focus:outline-none focus:ring-2 focus:ring-blue-600" />

      {price && amount && (
        <p className="text-xs text-slate-400">
          الإجمالي: <span className="text-white font-bold">
            {(Number(price) * Number(amount)).toLocaleString()} SDG
          </span>
        </p>
      )}

      <input type="text" placeholder="رقم عملية بنكك (اختياري)"
        value={paymentRef} onChange={e => setPaymentRef(e.target.value)}
        className="w-full p-2.5 bg-slate-800 rounded focus:outline-none focus:ring-2 focus:ring-blue-600" />

      <div>
        <label className="text-slate-400 text-xs block mb-1">إيصال التحويل (صورة)</label>
        <input type="file" accept="image/*"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
          className="w-full text-xs file:bg-blue-600 file:text-white file:border-0 file:rounded file:px-3 file:py-1.5 file:mr-2 file:cursor-pointer" />
      </div>

      <button type="submit" disabled={submitting}
        className="w-full bg-blue-600 hover:bg-blue-700 py-2.5 rounded font-bold disabled:opacity-50 transition">
        {submitting ? 'جاري الإرسال...' : 'إرسال الطلب'}
      </button>
    </form>
  )
}
