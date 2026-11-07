import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!url || !anon) {
  console.warn('⚠️ متغيرات Supabase غير معرّفة في البيئة')
}

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
})

/**
 * التحقق من أن المستخدم الحالي أدمن.
 * تقرأ الدور من جدول profiles في قاعدة البيانات.
 */
export async function isCurrentUserAdmin(): Promise<boolean> {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) return false

    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (error) {
      console.error('isCurrentUserAdmin error:', error.message)
      return false
    }

    return data?.role === 'admin'
  } catch (err) {
    console.error('isCurrentUserAdmin exception:', err)
    return false
  }
}

/**
 * جلب ملف المستخدم الحالي بما فيه الأرصدة (المتاحة والمحجوزة).
 */
export async function getUserProfile() {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, role, nil_balance, sdg_balance, nil_locked, sdg_locked')
      .eq('id', user.id)
      .single()

    if (error) {
      console.error('getUserProfile error:', error.message)
      return null
    }

    return data
  } catch (err) {
    console.error('getUserProfile exception:', err)
    return null
  }
}
