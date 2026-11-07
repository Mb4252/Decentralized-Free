import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true }
})

export async function isCurrentUserAdmin(): Promise<boolean> {
  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) return false

    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    // هذا السطر سيطبع النتيجة في الـ Console لمعرفة سبب المشكلة
    console.log('🔍 فحص الأدمن:', { data, error, userId: user.id })

    if (error) return false
    return data?.role === 'admin'
  } catch (err) {
    console.error('🔍 خطأ فادح:', err)
    return false
  }
}
