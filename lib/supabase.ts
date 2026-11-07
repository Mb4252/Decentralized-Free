import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!url || !anon) {
  console.warn('⚠️ متغيرات Supabase غير معرّفة في البيئة')
}

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true }
})

export async function isCurrentUserAdmin(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (error) return false
  return data?.role === 'admin'
}
