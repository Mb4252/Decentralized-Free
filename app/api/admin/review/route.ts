import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

// التحقق من أن الطالب أدمن عبر توكن الجلسة
async function requireAdmin(req: NextRequest): Promise<{ ok: boolean; userId?: string }> {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return { ok: false }
  const token = auth.slice(7)

  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { data: { user }, error } = await anon.auth.getUser(token)
  if (error || !user) return { ok: false }

  const admin = getAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  return { ok: profile?.role === 'admin', userId: user.id }
}

export async function GET(req: NextRequest) {
  const { ok } = await requireAdmin(req)
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('orders')
    .select('*')
    .in('status', ['open', 'matched', 'paid'])
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const { ok } = await requireAdmin(req)
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orderId, action } = await req.json() as {
    orderId: string
    action: 'release' | 'cancel' | 'mark_paid'
  }
  if (!orderId || !action) {
    return NextResponse.json({ error: 'orderId و action مطلوبان' }, { status: 400 })
  }

  const admin = getAdminClient()

  try {
    if (action === 'release') {
      const { error } = await admin
        .from('orders')
        .update({ status: 'released', escrow_locked: false })
        .eq('id', orderId)
      if (error) throw error
    } else if (action === 'cancel') {
      const { error } = await admin
        .from('orders')
        .update({ status: 'cancelled', escrow_locked: false })
        .eq('id', orderId)
      if (error) throw error
    } else if (action === 'mark_paid') {
      const { error } = await admin
        .from('orders')
        .update({ status: 'paid' })
        .eq('id', orderId)
      if (error) throw error
    }
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
