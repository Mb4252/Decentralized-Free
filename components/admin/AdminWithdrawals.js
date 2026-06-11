'use client'

import { useEffect, useState } from 'react'
import { supabaseAdmin } from '@/lib/supabase/admin'

export default function AdminWithdrawals() {
  const [withdrawals, setWithdrawals] = useState([])
  const [loading, setLoading] = useState(true)
  
  useEffect(() => {
    fetchWithdrawals()
  }, [])
  
  const fetchWithdrawals = async () => {
    const { data, error } = await supabaseAdmin
      .from('withdrawals')
      .select(`
        *,
        users (email, name, available_balance)
      `)
      .order('created_at', { ascending: false })
    
    if (!error) {
      setWithdrawals(data)
    }
    setLoading(false)
  }
  
  const handleApprove = async (withdrawalId, userId, amount) => {
    // التحقق من الرصيد مرة أخرى
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('available_balance')
      .eq('id', userId)
      .single()
    
    if (user.available_balance < amount) {
      alert('الرصيد غير كافٍ لهذا السحب')
      return
    }
    
    // تحديث حالة السحب
    const { error: updateError } = await supabaseAdmin
      .from('withdrawals')
      .update({ 
        status: 'approved',
        processed_at: new Date().toISOString()
      })
      .eq('id', withdrawalId)
    
    if (updateError) {
      alert('خطأ في الموافقة على السحب')
      return
    }
    
    // تحديث رصيد المستخدم (تم تجميده مسبقاً، الآن يتم خصمه نهائياً)
    await supabaseAdmin
      .from('users')
      .update({
        total_withdrawn: user.total_withdrawn + amount
      })
      .eq('id', userId)
    
    // تحديث حالة المعاملة
    await supabaseAdmin
      .from('transactions')
      .update({ status: 'approved' })
      .eq('reference_id', withdrawalId)
      .eq('type', 'withdraw')
    
    fetchWithdrawals()
  }
  
  const handleReject = async (withdrawalId, userId, amount) => {
    // رد الرصيد المجمد للمستخدم
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('available_balance')
      .eq('id', userId)
      .single()
    
    await supabaseAdmin
      .from('users')
      .update({ available_balance: user.available_balance + amount })
      .eq('id', userId)
    
    // تحديث حالة السحب
    await supabaseAdmin
      .from('withdrawals')
      .update({ status: 'rejected' })
      .eq('id', withdrawalId)
    
    // تحديث حالة المعاملة
    await supabaseAdmin
      .from('transactions')
      .update({ status: 'rejected' })
      .eq('reference_id', withdrawalId)
      .eq('type', 'withdraw')
    
    fetchWithdrawals()
  }
  
  if (loading) return <div>جاري التحميل...</div>
  
  return (
    <div className="bg-white rounded-xl shadow overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">المستخدم</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">المبلغ</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">المحفظة</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">التاريخ</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">الحالة</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">إجراءات</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {withdrawals.map((withdrawal) => (
            <tr key={withdrawal.id}>
              <td className="px-6 py-4">
                <div>{withdrawal.users?.name || withdrawal.users?.email}</div>
                <div className="text-sm text-gray-500">الرصيد: {withdrawal.users?.available_balance} USDT</div>
              </td>
              <td className="px-6 py-4">{withdrawal.amount} USDT</td>
              <td className="px-6 py-4">
                <span className="text-sm font-mono">{withdrawal.wallet_address?.substring(0, 10)}...</span>
              </td>
              <td className="px-6 py-4">{new Date(withdrawal.created_at).toLocaleDateString('ar')}</td>
              <td className="px-6 py-4">
                <span className={`px-2 py-1 rounded-full text-xs ${
                  withdrawal.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                  withdrawal.status === 'approved' ? 'bg-green-100 text-green-800' :
                  'bg-red-100 text-red-800'
                }`}>
                  {withdrawal.status === 'pending' ? 'قيد الانتظار' :
                   withdrawal.status === 'approved' ? 'تمت الموافقة' : 'مرفوض'}
                </span>
              </td>
              <td className="px-6 py-4">
                {withdrawal.status === 'pending' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApprove(withdrawal.id, withdrawal.user_id, withdrawal.amount)}
                      className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700"
                    >
                      موافقة
                    </button>
                    <button
                      onClick={() => handleReject(withdrawal.id, withdrawal.user_id, withdrawal.amount)}
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
