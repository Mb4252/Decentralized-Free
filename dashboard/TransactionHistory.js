'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function TransactionHistory({ userId }) {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()
  
  useEffect(() => {
    if (userId) {
      fetchTransactions()
    }
  }, [userId])
  
  const fetchTransactions = async () => {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10)
    
    if (!error) {
      setTransactions(data || [])
    }
    setLoading(false)
  }
  
  const getTypeText = (type) => {
    switch(type) {
      case 'deposit': return 'إيداع'
      case 'withdraw': return 'سحب'
      case 'profit': return 'أرباح'
      case 'referral_bonus': return 'مكافأة إحالة'
      default: return type
    }
  }
  
  const getTypeColor = (type) => {
    switch(type) {
      case 'deposit': return 'text-green-600 bg-green-50'
      case 'profit': return 'text-blue-600 bg-blue-50'
      case 'withdraw': return 'text-red-600 bg-red-50'
      default: return 'text-gray-600 bg-gray-50'
    }
  }
  
  if (loading) return <div className="bg-white rounded-xl shadow-md p-6">جاري تحميل المعاملات...</div>
  
  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <h3 className="text-xl font-bold mb-4">📋 آخر المعاملات</h3>
      {transactions.length === 0 ? (
        <p className="text-gray-500 text-center py-8">لا توجد معاملات حتى الآن</p>
      ) : (
        <div className="space-y-3">
          {transactions.map((tx) => (
            <div key={tx.id} className="flex justify-between items-center p-3 border rounded-lg">
              <div>
                <span className={`px-2 py-1 rounded-full text-xs ${getTypeColor(tx.type)}`}>
                  {getTypeText(tx.type)}
                </span>
                {tx.description && (
                  <p className="text-xs text-gray-500 mt-1">{tx.description}</p>
                )}
              </div>
              <div className="text-right">
                <div className={`font-bold ${tx.type === 'withdraw' ? 'text-red-600' : 'text-green-600'}`}>
                  {tx.type === 'withdraw' ? '-' : '+'}{tx.amount} USDT
                </div>
                <div className="text-xs text-gray-500">
                  {new Date(tx.created_at).toLocaleDateString('ar')}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
