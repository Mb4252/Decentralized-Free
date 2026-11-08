'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from './Toast'

export default function P2PModal({ onClose }: { onClose: () => void }) {
  const [side, setSide] = useState<'buy'|'sell'>('buy')
  const [price, setPrice] = useState('')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCreateAd() {
    if (!price || !amount) return toast('أدخل السعر والكمية', 'error')
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error } = await supabase.from('orders').insert({
      user_id: user.id, side, price: Number(price), amount: Number(amount), status: 'open'
    })

    if (error) toast(error.message, 'error')
    else {
      toast('تم إضافة الإعلان بنجاح', 'success')
      onClose()
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50
