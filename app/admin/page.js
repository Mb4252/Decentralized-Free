'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase/admin'

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('deposits')
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminEmail, setAdminEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [deposits, setDeposits] = useState([])
  const [withdrawals, setWithdrawals] = useState([])
  const [users, setUsers] = useState([])
  const router = useRouter()

  useEffect(() => {
    // التحقق من صلاحيات المدير
    const adminData = localStorage.getItem('admin')
    const userData = localStorage.getItem('user')
    
    if (!adminData && !userData) {
      router.push('/login')
      return
    }
    
    try {
      const data = adminData ? JSON.parse(adminData) : JSON.parse(userData)
      const adminEmails = process.env.NEXT_PUBLIC_ADMIN_EMAILS?.split(',') || []
      
      if (adminEmails.includes(data.email)) {
        setIsAdmin(true)
        setAdminEmail(data.email)
        if (!adminData) {
          localStorage.setItem('admin', JSON.stringify({ email: data.email }))
        }
        // جلب البيانات
        fetchDeposits()
        fetchWithdrawals()
        fetchUsers()
      } else {
        router.push('/dashboard')
      }
    } catch (error) {
      router.push('/login')
    } finally {
      setLoading(false)
    }
  }, [router])

  const fetchDeposits = async () => {
    const { data } = await supabaseAdmin
      .from('deposit_requests')
      .select('*, users(email, name)')
      .order('created_at', { ascending: false })
    setDeposits(data || [])
  }

  const fetchWithdrawals = async () => {
    const { data } = await supabaseAdmin
      .from('withdrawals')
      .select('*, users(email, name, available_balance)')
      .order('created_at', { ascending: false })
    setWithdrawals(data || [])
  }

  const fetchUsers = async () => {
    const { data } = await supabaseAdmin
      .from('users')
      .select('*, tiers(name)')
      .order('created_at', { ascending: false })
    setUsers(data || [])
  }

  const handleApproveDeposit = async (depositId, userId, amount) => {
    await supabaseAdmin
      .from('deposit_requests')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', depositId)

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('active_deposit, total_deposited')
      .eq('id', userId)
      .single()

    await supabaseAdmin
      .from('users')
      .update({
        active_deposit: (user?.active_deposit || 0) + amount,
        total_deposited: (user?.total_deposited || 0) + amount
      })
      .eq('id', userId)

    await supabaseAdmin
      .from('investments')
      .insert({
        user_id: userId,
        amount: amount,
        status: 'active',
        activated_at: new Date().toISOString()
      })

    fetchDeposits()
  }

  const handleRejectDeposit = async (depositId) => {
    await supabaseAdmin
      .from('deposit_requests')
      .update({ status: 'rejected' })
      .eq('id', depositId)
    fetchDeposits()
  }

  const handleApproveWithdrawal = async (withdrawalId, userId, amount) => {
    await supabaseAdmin
      .from('withdrawals')
      .update({ status: 'approved', processed_at: new Date().toISOString() })
      .eq('id', withdrawalId)

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('total_withdrawn')
      .eq('id', userId)
      .single()

    await supabaseAdmin
      .from('users')
      .update({
        total_withdrawn: (user?.total_withdrawn || 0) + amount
      })
      .eq('id', userId)

    fetchWithdrawals()
  }

  const handleRejectWithdrawal = async (withdrawalId, userId, amount) => {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('available_balance')
      .eq('id', userId)
      .single()

    await supabaseAdmin
      .from('users')
      .update({ available_balance: (user?.available_balance || 0) + amount })
      .eq('id', userId)

    await supabaseAdmin
      .from('withdrawals')
      .update({ status: 'rejected' })
      .eq('id', withdrawalId)

    fetchWithdrawals()
  }

  const handleLogout = () => {
    localStorage.removeItem('user')
    localStorage.removeItem('admin')
    router.push('/login')
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">جاري التحميل...</div>
  }

  if (!isAdmin) return null

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="text-2xl font-bold text-blue-600">لوحة المدير</div>
          <div className="flex items-center gap-4">
            <span className="text-gray-600">مرحباً {adminEmail}</span>
            <button onClick={handleLogout} className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg">تسجيل خروج</button>
          </div>
        </div>
      </nav>

      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <h1 className="text-3xl font-bold text-gray-800 mb-8">لوحة تحكم المدير</h1>

        <div className="mb-6 border-b border-gray-200 bg-white rounded-t-lg">
          <div className="flex gap-4 px-4">
            <button onClick={() => setActiveTab('deposits')} className={`px-4 py-3 font-medium ${activeTab === 'deposits' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-600'}`}>📥 طلبات الإيداع</button>
            <button onClick={() => setActiveTab('withdrawals')} className={`px-4 py-3 font-medium ${activeTab === 'withdrawals' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-600'}`}>📤 طلبات السحب</button>
            <button onClick={() => setActiveTab('users')} className={`px-4 py-3 font-medium ${activeTab === 'users' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-600'}`}>👥 المستخدمين</button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          {activeTab === 'deposits' && (
            <div>
              <h2 className="text-xl font-bold mb-4">طلبات الإيداع</h2>
              {deposits.length === 0 ? (
                <p>لا توجد طلبات</p>
              ) : (
                <table className="w-full">
                  <thead><tr><th>المستخدم</th><th>المبلغ</th><th>التاريخ</th><th>الحالة</th><th>إجراءات</th></tr></thead>
                  <tbody>
                    {deposits.map(d => (
                      <tr key={d.id}>
                        <td>{d.users?.email}</td><td>{d.amount} USDT</td><td>{new Date(d.created_at).toLocaleDateString()}</td>
                        <td>{d.status}</td>
                        <td>{d.status === 'pending' && (<><button onClick={() => handleApproveDeposit(d.id, d.user_id, d.amount)} className="bg-green-600 text-white px-2 py-1 rounded m-1">موافقة</button><button onClick={() => handleRejectDeposit(d.id)} className="bg-red-600 text-white px-2 py-1 rounded">رفض</button></>)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {activeTab === 'withdrawals' && (
            <div>
              <h2 className="text-xl font-bold mb-4">طلبات السحب</h2>
              {withdrawals.length === 0 ? <p>لا توجد طلبات</p> : (
                <table className="w-full"><thead><tr><th>المستخدم</th><th>المبلغ</th><th>التاريخ</th><th>الحالة</th><th>إجراءات</th></tr></thead>
                <tbody>{withdrawals.map(w => (<tr key={w.id}><td>{w.users?.email}</td><td>{w.amount} USDT</td><td>{new Date(w.created_at).toLocaleDateString()}</td><td>{w.status}</td><td>{w.status === 'pending' && (<><button onClick={() => handleApproveWithdrawal(w.id, w.user_id, w.amount)} className="bg-green-600 text-white px-2 py-1 rounded m-1">موافقة</button><button onClick={() => handleRejectWithdrawal(w.id, w.user_id, w.amount)} className="bg-red-600 text-white px-2 py-1 rounded">رفض</button></>)}</td></tr>))}</tbody></table>
              )}
            </div>
          )}

          {activeTab === 'users' && (
            <div>
              <h2 className="text-xl font-bold mb-4">المستخدمين</h2>
              {users.length === 0 ? <p>لا يوجد مستخدمين</p> : (
                <table className="w-full"><thead><tr><th>البريد</th><th>المستوى</th><th>الاستثمار النشط</th><th>الرصيد</th></tr></thead>
                <tbody>{users.map(u => (<tr key={u.id}><td>{u.email}</td><td>{u.tiers?.name || 'مبتدئ'}</td><td>{u.active_deposit || 0} USDT</td><td>{u.available_balance || 0} USDT</td></tr>))}</tbody></table>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
