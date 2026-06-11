'use client'

import { useEffect, useState } from 'react'
import { supabaseAdmin } from '@/lib/supabase/admin'

export default function AdminDeposits() {
  const [deposits, setDeposits] = useState([])
  const [loading, setLoading] = useState(true)
  
  useEffect(() => {
    fetchDeposits()
  }, [])
  
  const fetchDeposits = async () => {
    const { data, error } = await supabaseAdmin
      .from('deposit_requests')
      .select(`
        *,
        users (email, name)
      `)
      .order('created_at', { ascending: false })
    
    if (!error) {
      setDeposits(data)
    }
    setLoading(false)
  }
  
  const handleApprove = async (depositId, userId, amount) => {
    const { error: updateError } = await supabaseAdmin
      .from('deposit_requests')
      .update({ 
        status: 'approved',
        approved_at: new Date().toISOString()
      })
      .eq('id', depositId)
    
    if (updateError) {
      alert('خطأ في الموافقة على الإيداع')
      return
    }
    
    // تحديث رصيد المستخدم وتفعيل الاستثمار
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('active_deposit, total_deposited')
      .eq('id', userId)
      .single()
    
    await supabaseAdmin
      .from('users')
      .update({
        active_deposit: (user.active_deposit || 0) + amount,
        total_deposited: (user.total_deposited || 0) + amount
      })
      .eq('id', userId)
    
    // تسجيل الاستثمار
    await supabaseAdmin
      .from('investments')
      .insert({
        user_id: userId,
        amount: amount,
        status: 'active',
        activated_at: new Date().toISOString()
      })
    
    // تسجيل المعاملة
    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'deposit',
        amount: amount,
        status: 'approved',
        description: 'Deposit approved by admin'
      })
    
    fetchDeposits()
  }
  
  const handleReject = async (depositId) => {
    await supabaseAdmin
      .from('deposit_requests')
      .update({ status: 'rejected' })
      .eq('id', depositId)
    
    fetchDeposits()
  }
  
  if (loading) return <div>جاري التحميل...</div>
  
  return (
    <div className="bg-white rounded-xl shadow overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">المستخدم</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">المبلغ</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">التاريخ</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">الحالة</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">إجراءات</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {deposits.map((deposit) => (
            <tr key={deposit.id}>
              <td className="px-6 py-4">
                <div>{deposit.users?.name || deposit.users?.email}</div>
                <div className="text-sm text-gray-500">{deposit.users?.email}</div>
              </td>
              <td className="px-6 py-4">{deposit.amount} USDT</td>
              <td className="px-6 py-4">{new Date(deposit.created_at).toLocaleDateString('ar')}</td>
              <td className="px-6 py-4">
                <span className={`px-2 py-1 rounded-full text-xs ${
                  deposit.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                  deposit.status === 'approved' ? 'bg-green-100 text-green-800' :
                  'bg-red-100 text-red-800'
                }`}>
                  {deposit.status === 'pending' ? 'قيد الانتظار' :
                   deposit.status === 'approved' ? 'تمت الموافقة' : 'مرفوض'}
                </span>
              </td>
              <td className="px-6 py-4">
                {deposit.status === 'pending' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApprove(deposit.id, deposit.user_id, deposit.amount)}
                      className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700"
                    >
                      موافقة
                    </button>
                    <button
                      onClick={() => handleReject(deposit.id)}
                      className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700"
                    >
                      رفض
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
