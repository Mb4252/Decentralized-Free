import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import bcrypt from 'bcryptjs'

export async function POST(request) {
  try {
    const { amount, pin, walletAddress, email } = await request.json()
    
    // التحقق من صحة البيانات
    if (!amount || amount < 10) {
      return NextResponse.json({ error: 'Minimum withdrawal is 10 USDT' }, { status: 400 })
    }
    
    if (!pin || pin.length !== 4) {
      return NextResponse.json({ error: 'PIN must be 4 digits' }, { status: 400 })
    }
    
    if (!walletAddress || walletAddress.length < 10) {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 })
    }
    
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }
    
    // جلب بيانات المستخدم
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, available_balance, active_deposit, withdraw_pin')
      .eq('email', email)
      .single()
    
    if (userError || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    
    // التحقق من PIN
    const isValidPin = await bcrypt.compare(pin, user.withdraw_pin)
    if (!isValidPin) {
      return NextResponse.json({ error: 'Invalid PIN' }, { status: 403 })
    }
    
    // شرط: يجب أن يكون لديه إيداع نشط
    if (user.active_deposit <= 0) {
      return NextResponse.json({ error: 'Must have active deposit to withdraw' }, { status: 403 })
    }
    
    // التحقق من الرصيد
    if (user.available_balance < amount) {
      return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 })
    }
    
    // إنشاء طلب سحب
    const { data: withdrawal, error: withdrawalError } = await supabaseAdmin
      .from('withdrawals')
      .insert({
        user_id: user.id,
        amount,
        wallet_address: walletAddress,
        pin_verified: true,
        status: 'pending'
      })
      .select()
      .single()
    
    if (withdrawalError) {
      console.error('Withdrawal error:', withdrawalError)
      return NextResponse.json({ error: 'Failed to create withdrawal request' }, { status: 500 })
    }
    
    // تجميد الرصيد مؤقتاً
    await supabaseAdmin
      .from('users')
      .update({ available_balance: user.available_balance - amount })
      .eq('id', user.id)
    
    // تسجيل المعاملة
    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: user.id,
        type: 'withdraw',
        amount: amount,
        status: 'pending',
        reference_id: withdrawal.id,
        description: 'Withdrawal request pending admin approval'
      })
    
    return NextResponse.json({ 
      success: true, 
      withdrawalId: withdrawal.id,
      message: 'Withdrawal request submitted successfully' 
    })
    
  } catch (error) {
    console.error('Withdrawal error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
