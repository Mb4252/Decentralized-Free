'use client'

import { useState } from 'react'
import { signInWithPopup, googleProvider, auth } from '@/lib/firebase/client'
import { useRouter } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase/admin'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  const generateReferralCode = () => {
    return Math.random().toString(36).substring(2, 10).toUpperCase()
  }

  const handleGoogleLogin = async () => {
    setLoading(true)
    setError('')

    try {
      // تسجيل الدخول عبر Firebase
      const result = await signInWithPopup(auth, googleProvider)
      const user = result.user

      // التحقق من وجود المستخدم في Supabase
      const { data: existingUser, error: fetchError } = await supabaseAdmin
        .from('users')
        .select('id, email')
        .eq('email', user.email)
        .single()

      if (!existingUser && !fetchError) {
        // إنشاء مستخدم جديد
        const defaultPin = Math.floor(1000 + Math.random() * 9000).toString()
        
        // تخزين PIN مؤقتاً (سيتم تغييره لاحقاً)
        const { error: insertError } = await supabaseAdmin
          .from('users')
          .insert({
            email: user.email,
            name: user.displayName,
            withdraw_pin: defaultPin, // سيتم تشفيره لاحقاً
            referral_code: generateReferralCode(),
            tier_id: 1,
            firebase_uid: user.uid
          })

        if (insertError) {
          console.error('Error creating user:', insertError)
          setError('حدث خطأ في إنشاء الحساب')
          setLoading(false)
          return
        }

        // إشعار بـ PIN (في الإنتاج أرسله بريد إلكتروني)
        console.log(`New user: ${user.email}, PIN: ${defaultPin}`)
      }

      // تخزين معلومات الجلسة (بدون NextAuth)
      localStorage.setItem('user', JSON.stringify({
        id: existingUser?.id,
        email: user.email,
        name: user.displayName,
        firebaseUid: user.uid
      }))

      router.push('/dashboard')

    } catch (error) {
      console.error('Login error:', error)
      setError('فشل تسجيل الدخول. حاول مرة أخرى.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="bg-white rounded-xl shadow-md p-8 max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">منصة الاستثمار</h1>
          <p className="text-gray-600">استثمر في العملات الرقمية بثقة</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-center">
            {error}
          </div>
        )}

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full bg-white border border-gray-300 text-gray-700 px-4 py-3 rounded-lg flex items-center justify-center gap-3 hover:bg-gray-50 transition"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          {loading ? 'جاري التحويل...' : 'تسجيل الدخول بـ Google (Firebase)'}
        </button>

        <p className="mt-6 text-center text-sm text-gray-500">
          بالتسجيل أنت توافق على الشروط والأحكام
        </p>
      </div>
    </div>
  )
}
