'use client'

import { useState, useEffect } from 'react'
import { auth } from '@/lib/firebase/client'

export default function WithdrawModal({ onSuccess }) {
  const [isOpen, setIsOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [pin, setPin] = useState('')
  const [walletAddress, setWalletAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [token, setToken] = useState(null)
  
  useEffect(() => {
    const getToken = async () => {
      const user = auth.currentUser
      if (user) {
        const idToken = await user.getIdToken()
        setToken(idToken)
      }
    }
    getToken()
  }, [])
  
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
    
    if (!walletAddress || walletAddress.length < 10) {
      setMessage('عنوان المحفظة غير صحيح')
      setLoading(false)
      return
    }
    
    try {
      const response = await fetch('/api/withdraw/request', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          amount: withdrawAmount,
          pin,
          walletAddress
        })
      })
      
      const data = await response.json()
      
      if (response.ok) {
        setMessage('تم إرسال طلب السحب بنجاح، بانتظار موافقة المدير')
        setAmount('')
        setPin('')
        setWalletAddress('')
        setTimeout(() => {
          setIsOpen(false)
          if (onSuccess) onSuccess()
        }, 2000)
      } else {
        setMessage(data.error || 'حدث خطأ في طلب السحب')
      }
    } catch (error) {
      setMessage('حدث خطأ في الاتصال بالسيرفر')
    } finally {
      setLoading(false)
    }
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
              
              <div className="mb-4">
                <label className="block text-gray-700 mb-2">عنوان المحفظة (BSC)</label>
                <input
                  type="text"
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0x..."
                  required
                />
              </div>
              
              <div className="mb-4">
                <label className="block text-gray-700 mb-2">PIN السحب (4 أرقام)</label>
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="****"
                  required
                  maxLength="4"
                  pattern="\d{4}"
                />
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
                  {loading ? 'جاري المعالجة...' : 'طلب السحب'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
