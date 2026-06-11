'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSession } from 'next-auth/react'

export default function WithdrawModal({ onSuccess }) {
  const [isOpen, setIsOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [pin, setPin] = useState('')
  const [walletAddress, setWalletAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const { data: session } = useSession()
  const supabase = createClient()
  
  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    
    const withdrawAmount = parseFloat(amount)
    
    if (withdrawAmount < 10) {
      setMessage('الحد الأدنى للسحب 10 USDT')
      setLoading(false)
      return
    }
    
    if (pin.length !== 4 || !/^\d+$/.test(pin)) {
      setMessage('PIN يجب أن يكون 4 أرقام')
      setLoading(false)
      return
    }
    
    const response = await fetch('/api/withdraw/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: withdrawAmount,
        pin,
        walletAddress
      })
    })
    
    const data = await response.json()
    
    if (response.ok) {
      setMessage('تم إرسال طلب السحب بنجاح، بانتظار موافقة المدير')
      setTimeout(() => {
        setIsOpen(false)
        onSuccess()
      }, 2000)
    } else {
      setMessage(data.error || 'حدث خطأ في طلب السحب')
    }
    
    setLoading(false)
  }
  
  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="btn-secondary w-full"
      >
        سحب الأرباح
      </button>
      
      {isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <h2 className="text-2xl font-bold mb-4">سحب الأرباح</h2>
            
            <form onSubmit={handleSubmit}>
              <div className
