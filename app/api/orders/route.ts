import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const side = req.nextUrl.searchParams.get('side')
  let q = supabase.from('orders').select('*').eq('status', 'open')
  if (side === 'buy' || side === 'sell') q = q.eq('side', side)
  const { data, error } = await q.order('price', { ascending: side === 'sell' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
