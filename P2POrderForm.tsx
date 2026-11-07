'use client'
import { useState, useEffect } from 'react'
import { supabase, getUserProfile } from '@/lib/supabase'
import { toast } from './Toast'
import { formatNumber } from '@/lib/utils'

export default function P2POrderForm({ userId }: { userId: string }) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [price, setPrice] = useState('')
  const [amount, setAmount] = useState('')
  const [paymentRef, setPaymentRef] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [profile, setProfile] = useState<any>(null)

  useEffect(() => { getUserProfile().then(setProfile) }, [])

  // ... (دالة رفع الإيصال كما هي)
  async function uploadReceipt(): Promise<string | null> {
    if (!file) return null
    const fileName = `${userId}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`
    const { error } = await supabase.storage.from('receipts').upload(fileName, file)
    if (error) throw error
    const { data } = supabase.storage.from('receipts').getPublicUrl(fileName)
    return data.publicUrl
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return

    const numPrice = Number(price)
    const numAmount = Number(amount)
    const totalCost = numPrice * numAmount

    if (side === 'buy' && totalCost > profile.sdg_balance) {
      return toast('رصيد SDG غير كافٍ', 'error')
    }
    if (side === 'sell' && numAmount > profile.nil_balance) {
      return toast('رصيد NIL غير كافٍ', 'error')
    }

    setSubmitting(true)
    try {
      const receiptUrl = await uploadReceipt()

      const { error } = await supabase.from('orders').insert({
        user_id: userId,
        side,
        price: numPrice,
        amount: numAmount,
        payment_ref: paymentRef || null,
        receipt_url: receiptUrl,
        status: 'open'
      })

      if (error) throw error
      toast('تم إرسال الطلب بنجاح', 'success')
      setPrice(''); setAmount(''); setPaymentRef(''); setFile(null)
      getUserProfile().then(setProfile) // تحديث الرصيد
    } catch (err: any) {
      toast(err.message ?? 'فشل الإرسال', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // ... (الـ return كما هو، أضف شريط الرصيد تحته)
  return (
    <form onSubmit={handleSubmit} className="bg-slate-900 rounded-lg p-4 space-y-3">
      {profile && (
        <div className="text-[10px] text-slate-400 flex justify-between bg-slate-800 p-2 rounded">
          <span>المتاح: {formatNumber(profile.nil_balance)} NIL</span>
          <span>المتاح: {formatNumber(profile.sdg_balance)} SDG</span>
        </div>
      )}
      
      {/* ... باقي النموذج كما هو */}
    </form>
  )
}
