'use client'

import { useSession } from "next-auth/react"
import { redirect } from "next/navigation"
import { useEffect, useState } from "react"
// استبدلنا @/ بالمسار النسبي ../../
import { supabaseAdmin } from "../../lib/supabase/admin"
import AdminDeposits from "../../components/admin/AdminDeposits"
import AdminWithdrawals from "../../components/admin/AdminWithdrawals"
import AdminUsers from "../../components/admin/AdminUsers"

export default function AdminPage() {
  // ... بقية الكود الخاص بك كما هو لا تغير فيه شيئاً
  const { data: session, status } = useSession()
  const [activeTab, setActiveTab] = useState('deposits')
  
  useEffect(() => {
    if (status === 'authenticated') {
      const adminEmails = process.env.NEXT_PUBLIC_ADMIN_EMAILS?.split(',') || []
      if (!adminEmails.includes(session.user.email)) {
        redirect('/dashboard')
      }
    }
  }, [session, status])
  
  if (status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center">جاري التحميل...</div>
  }
  
  if (status === 'unauthenticated') {
    redirect('/login')
  }
  
  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800">لوحة تحكم المدير</h1>
          <p className="text-gray-600">إدارة الإيداعات والسحوبات والمستخدمين</p>
        </div>
        
        <div className="mb-6 border-b border-gray-200">
          <nav className="flex gap-4">
            <button
              onClick={() => setActiveTab('deposits')}
              className={`px-4 py-2 font-medium transition-colors ${
                activeTab === 'deposits'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              طلبات الإيداع
            </button>
            <button
              onClick={() => setActiveTab('withdrawals')}
              className={`px-4 py-2 font-medium transition-colors ${
                activeTab === 'withdrawals'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              طلبات السحب
            </button>
            <button
              onClick={() => setActiveTab('users')}
              className={`px-4 py-2 font-medium transition-colors ${
                activeTab === 'users'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              المستخدمين
            </button>
          </nav>
        </div>
        
        {activeTab === 'deposits' && <AdminDeposits />}
        {activeTab === 'withdrawals' && <AdminWithdrawals />}
        {activeTab === 'users' && <AdminUsers />}
      </div>
    </div>
  )
}
