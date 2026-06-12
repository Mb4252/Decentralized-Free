'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'

// استيراد ديناميكي لتجنب أخطاء التحميل
const AdminDeposits = dynamic(() => import('@/components/admin/AdminDeposits'), { 
  ssr: false,
  loading: () => <div className="p-4 text-center">جاري تحميل طلبات الإيداع...</div>
})
const AdminWithdrawals = dynamic(() => import('@/components/admin/AdminWithdrawals'), { 
  ssr: false,
  loading: () => <div className="p-4 text-center">جاري تحميل طلبات السحب...</div>
})
const AdminUsers = dynamic(() => import('@/components/admin/AdminUsers'), { 
  ssr: false,
  loading: () => <div className="p-4 text-center">جاري تحميل المستخدمين...</div>
})

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState('deposits')
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminEmail, setAdminEmail] = useState('')
  const [loading, setLoading] = useState(true)
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
        // تأكد من وجود admin في localStorage
        if (!adminData) {
          localStorage.setItem('admin', JSON.stringify({ email: data.email }))
        }
      } else {
        router.push('/dashboard')
      }
    } catch (error) {
      router.push('/login')
    } finally {
      setLoading(false)
    }
  }, [router])

  const handleLogout = () => {
    localStorage.removeItem('user')
    localStorage.removeItem('admin')
    router.push('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="text-2xl mb-4">⏳</div>
          <p className="text-gray-600">جاري التحميل...</p>
        </div>
      </div>
    )
  }

  if (!isAdmin) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Navbar */}
      <nav className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="text-2xl font-bold text-blue-600">
            لوحة المدير
          </div>
          <div className="flex items-center gap-4">
            <span className="text-gray-600 hidden md:inline">
              مرحباً {adminEmail}
            </span>
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition"
            >
              تسجيل خروج
            </button>
          </div>
        </div>
      </nav>

      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800">لوحة تحكم المدير</h1>
          <p className="text-gray-600">إدارة الإيداعات والسحوبات والمستخدمين</p>
          <p className="text-sm text-gray-500 mt-1">
            البريد الإلكتروني: {adminEmail}
          </p>
        </div>

        {/* Tabs */}
        <div className="mb-6 border-b border-gray-200 bg-white rounded-t-lg">
          <nav className="flex gap-4 px-4">
            <button
              onClick={() => setActiveTab('deposits')}
              className={`px-4 py-3 font-medium transition-colors ${
                activeTab === 'deposits'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              📥 طلبات الإيداع
            </button>
            <button
              onClick={() => setActiveTab('withdrawals')}
              className={`px-4 py-3 font-medium transition-colors ${
                activeTab === 'withdrawals'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              📤 طلبات السحب
            </button>
            <button
              onClick={() => setActiveTab('users')}
              className={`px-4 py-3 font-medium transition-colors ${
                activeTab === 'users'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              👥 المستخدمين
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded-lg shadow">
          {activeTab === 'deposits' && <AdminDeposits />}
          {activeTab === 'withdrawals' && <AdminWithdrawals />}
          {activeTab === 'users' && <AdminUsers />}
        </div>
      </div>
    </div>
  )
}
