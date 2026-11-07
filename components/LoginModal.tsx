'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from './Toast'

export default function LoginModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        toast('تم تسجيل الدخول', 'success')
      } else {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        toast('تم إنشاء الحساب — تحقق من بريدك إن لزم', 'success')
      }
      onClose()
    } catch (err: any) {
      toast(err.message ?? 'فشل الاتصال', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-40 p-4" onClick={onClose}>
      <div className="bg-slate-900 rounded-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4 text-center">
          {mode === 'login' ? 'تسجيل الدخول' : 'حساب جديد'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input type="email" required placeholder="البريد الإلكتروني"
            value={email} onChange={e => setEmail(e.target.value)}
            className="w-full p-2.5 bg-slate-800 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-600" />
          <input type="password" required minLength={6} placeholder="كلمة المرور"
            value={password} onChange={e => setPassword(e.target.value)}
            className="w-full p-2.5 bg-slate-800 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-600" />
          <button type="submit" disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 py-2.5 rounded font-bold disabled:opacity-50">
            {loading ? '...' : mode === 'login' ? 'دخول' : 'إنشاء حساب'}
          </button>
        </form>
        <button onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
          className="mt-3 w-full text-sm text-slate-400 hover:text-white">
          {mode === 'login' ? 'ليس لديك حساب؟ أنشئ واحداً' : 'لديك حساب؟ سجّل الدخول'}
        </button>
      </div>
    </div>
  )
}
