'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase/admin'

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [referralCode, setReferralCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  // توليد رمز دعوة عشوائي
  const generateReferralCode = () => {
    return Math.random().toString(36).substring(2, 10).toUpperCase()
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    // البحث عن المستخدم في قاعدة البيانات
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email)
      .single()

    if (userError || !user) {
      setError('البريد الإلكتروني غير مسجل')
      setLoading(false)
      return
    }

    // تخزين بيانات المستخدم
    localStorage.setItem('user', JSON.stringify(user))
    localStorage.setItem('userEmail', user.email)

    // التحقق من صلاحيات المدير
    const adminEmails = process.env.NEXT_PUBLIC_ADMIN_EMAILS?.split(',') || []
    if (adminEmails.includes(user.email)) {
      localStorage.setItem('admin', JSON.stringify({ email: user.email }))
      router.push('/admin')
    } else {
      router.push('/dashboard')
    }

    setLoading(false)
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    // التحقق من وجود المستخدم
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('email', email)
      .single()

    if (existingUser) {
      setError('البريد الإلكتروني مسجل بالفعل')
      setLoading(false)
      return
    }

    // التحقق من رمز الدعوة (إذا وجد)
    let referrerId = null
    if (referralCode) {
      const { data: referrer } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('referral_code', referralCode)
        .single()
      
      if (referrer) {
        referrerId = referrer.id
      }
    }

    // إنشاء مستخدم جديد
    const defaultPin = Math.floor(1000 + Math.random() * 9000).toString()
    const newReferralCode = generateReferralCode()

    const { data: newUser, error: insertError } = await supabaseAdmin
      .from('users')
      .insert({
        email: email,
        name: email.split('@')[0],
        withdraw_pin: defaultPin,
        referral_code: newReferralCode,
        referrer_id: referrerId,
        tier_id: 1,
        password: password || null
      })
      .select()
      .single()

    if (insertError) {
      setError('حدث خطأ في إنشاء الحساب')
      setLoading(false)
      return
    }

    // تسجيل الدخول تلقائياً
    localStorage.setItem('user', JSON.stringify(newUser))
    localStorage.setItem('userEmail', newUser.email)
    router.push('/dashboard')
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-yellow-500">CryptoMine</h1>
          <p className="text-gray-400 mt-2">تعدين سحابي آمن ومربح</p>
        </div>

        {/* Card */}
        <div className="bg-gray-800 rounded-2xl shadow-xl p-8 border border-gray-700">
          {/* Tabs */}
          <div className="flex gap-4 mb-8">
            <button
              onClick={() => setIsLogin(true)}
              className={`flex-1 py-2 text-center rounded-lg transition ${isLogin ? 'bg-yellow-500 text-gray-900' : 'text-gray-400 hover:text-gray-200'}`}
            >
              تسجيل الدخول
            </button>
            <button
              onClick={() => setIsLogin(false)}
              className={`flex-1 py-2 text-center rounded-lg transition ${!isLogin ? 'bg-yellow-500 text-gray-900' : 'text-gray-400 hover:text-gray-200'}`}
            >
              إنشاء حساب
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded-lg text-red-400 text-center">
              {error}
            </div>
          )}

          {isLogin ? (
            <form onSubmit={handleLogin}>
              <div className="mb-4">
                <label className="block text-gray-300 mb-2">البريد الإلكتروني</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-yellow-500"
                  placeholder="example@email.com"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold py-3 rounded-lg transition disabled:opacity-50"
              >
                {loading ? 'جاري التسجيل...' : 'تسجيل الدخول'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister}>
              <div className="mb-4">
                <label className="block text-gray-300 mb-2">البريد الإلكتروني</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-yellow-500"
                  placeholder="example@email.com"
                  required
                />
              </div>
              <div className="mb-4">
                <label className="block text-gray-300 mb-2">كلمة المرور (اختياري)</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-yellow-500"
                  placeholder="********"
                />
              </div>
              <div className="mb-6">
                <label className="block text-gray-300 mb-2">رمز الدعوة (اختياري)</label>
                <input
                  type="text"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-yellow-500"
                  placeholder="XXXXXX"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold py-3 rounded-lg transition disabled:opacity-50"
              >
                {loading ? 'جاري إنشاء الحساب...' : 'إنشاء حساب'}
              </button>
            </form>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 mt-8">
          <div className="bg-gray-800 rounded-xl p-4 text-center border border-gray-700">
            <div className="text-2xl font-bold text-yellow-500">5,941+</div>
            <div className="text-gray-400 text-sm">مستخدم نشط</div>
          </div>
          <div className="bg-gray-800 rounded-xl p-4 text-center border border-gray-700">
            <div className="text-2xl font-bold text-yellow-500">$64,152+</div>
            <div className="text-gray-400 text-sm">إجمالي الأرباح</div>
          </div>
        </div>
      </div>
    </div>
  )
}
