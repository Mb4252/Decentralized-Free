import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const tf = req.nextUrl.searchParams.get('timeframe') ?? '15m'
  const { data, error } = await supabase
    .from('candles')
    .select('*')
    .eq('timeframe', tf)
    .order('open_time', { ascending: true })
    .limit(500)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
