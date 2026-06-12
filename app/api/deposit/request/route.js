import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function POST(request) {
  try {
    const { amount, email } = await request.json()
    
    if (!amount || amount < 10) {
      return NextResponse.json({ error: 'Minimum deposit is 10 USDT' }, { status: 400 })
    }
    
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }
    
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .single()
    
    if (userError || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    
    const { data: deposit, error: depositError } = await supabaseAdmin
      .from('deposit_requests')
      .insert({
        user_id: user.id,
        amount,
        status: 'pending'
      })
      .select()
      .single()
    
    if (depositError) {
      return NextResponse.json({ error: 'Failed to create deposit request' }, { status: 500 })
    }
    
    return NextResponse.json({
      success: true,
      depositId: deposit.id,
      message: 'Deposit request submitted successfully'
    })
    
  } catch (error) {
    console.error('Deposit error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
