'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useSession } from 'next-auth/react'

export default function DepositModal({ onSuccess }) {
  const [isOpen, setIsOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const { data: session } = useSession()
  const supabase = createClient()
  
  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    
    const depositAmount = parseFloat(amount)
    
    if (depositAmount < 10) {
      setMessage('الحد الأدنى للإيداع 10 USDT')
      setLoading(false)
      return
    }
    
    const { data, error } = await supabase
      .from('deposit_requests')
      .insert({
        user_id: session.user.id,
        amount: depositAmount,
        status: 'pending'
      })
      .select()
      .single()
    
    if (error) {
      setMessage('حدث خطأ، حاول مرة أخرى')
    } else {
      setMessage('تم إرسال طلب الإيداع بنجاح، بانتظار موافقة المدير')
      setAmount('')
      setTimeout(() => {
        setIsOpen(false)
        onSuccess()
      }, 2000)
    }
    
    setLoading(false)
  }
  
  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="btn-primary w-full"
      >
        إيداع USDT
      </button>
      
      {isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <h2 className="text-2xl font-bold mb-4">إيداع USDT</h2>
            
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="block text-gray-700 mb-2">المبلغ (USDT)</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="أدخل المبلغ"
                  required
                  min="10"
                  step="0.01"
                />
              </div>
              
              <div className="mb-4 p-3 bg-yellow-50 rounded-lg">
                <p className="text-sm text-yellow-800">
                  ⚠️ يرجى إرسال المبلغ إلى المحفظة التالية ثم إرفاق رابط التحويل في قناة الدعم
                </p>
                <code className="block mt-2 p-2 bg-white rounded text-sm break-all">
                  0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0
                </code>
                <a 
                  href={process.env.NEXT_PUBLIC_SUPPORT_CHANNEL_URL || 'https://t.me/your_support'}
                  target="_blank"
                  className="inline-block mt-2 text-blue-600 text-sm"
                >
                  📢 رابط قناة الدعم
                </a>
              </div>
              
              {message && (
                <div className={`mb-4 p-3 rounded-lg ${message.includes('نجاح') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {message}
                </div>
              )}
              
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="flex-1 btn-secondary"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 btn-primary"
                >
                  {loading ? 'جاري الإرسال...' : 'إرسال الطلب'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
