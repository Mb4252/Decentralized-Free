'use client'

import { useEffect, useState } from 'react'
import { supabaseAdmin } from '@/lib/supabase/admin'

export default function AdminUsers() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  
  useEffect(() => {
    fetchUsers()
  }, [])
  
  const fetchUsers = async () => {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select(`
        *,
        tiers (name)
      `)
      .order('created_at', { ascending: false })
    
    if (!error) {
      setUsers(data || [])
    }
    setLoading(false)
  }
  
  if (loading) return <div className="p-4">جاري التحميل...</div>
  
  if (users.length === 0) {
    return <div className="p-4 text-center text-gray-500">لا يوجد مستخدمين</div>
  }
  
  return (
    <div className="bg-white rounded-xl shadow overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">المستخدم</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">المستوى</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">الاستثمار النشط</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">الرصيد المتاح</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">تاريخ التسجيل</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {users.map((user) => (
            <tr key={user.id}>
              <td className="px-6 py-4">
                <div>{user.name || user.email}</div>
                <div className="text-sm text-gray-500">{user.email}</div>
                {user.referral_code && (
                  <div className="text-xs text-gray-400">كود: {user.referral_code}</div>
                )}
               </td>
              <td className="px-6 py-4">
                <span className="px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
                  {user.tiers?.name || 'مبتدئ'}
                </span>
               </td>
              <td className="px-6 py-4">{user.active_deposit || 0} USDT</td>
              <td className="px-6 py-4">{user.available_balance || 0} USDT</td>
              <td className="px-6 py-4">{new Date(user.created_at).toLocaleDateString('ar')}</td>
             </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
