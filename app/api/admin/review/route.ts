import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

function checkAdmin(req: NextRequest): boolean {
  const key = req.headers.get('x-admin-key')
  const expected = process.env.ADMIN_SECRET_KEY
  return !!expected && key === expected
}

export async function GET(req: NextRequest) {
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
  if (!checkAdmin(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { orderId, action } = body as { orderId: string; action: 'release' | 'cancel' | 'mark_paid' }

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
    } else {
      return NextResponse.json({ error: 'إجراء غير معروف' }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
