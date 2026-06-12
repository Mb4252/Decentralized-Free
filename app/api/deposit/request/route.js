import { NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function POST(request) {
  try {
    // الحصول على token من الـ headers
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.split('Bearer ')[1]
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    // التحقق من صحة الـ token عبر Firebase Admin
    let decodedToken
    try {
      decodedToken = await adminAuth.verifyIdToken(token)
    } catch (error) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }
    
    const email = decodedToken.email
    const { amount, transactionHash } = await request.json()
    
    if (!amount || amount < 10) {
      return NextResponse.json({ error: 'Minimum deposit is 10 USDT' }, { status: 400 })
    }
    
    // جلب المستخدم من قاعدة البيانات
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .single()
    
    if (userError || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    
    // إنشاء طلب إيداع
    const { data: deposit, error: depositError } = await supabaseAdmin
      .from('deposit_requests')
      .insert({
        user_id: user.id,
        amount,
        transaction_hash: transactionHash || null,
        status: 'pending'
      })
      .select()
      .single()
    
    if (depositError) {
      console.error('Deposit request error:', depositError)
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
