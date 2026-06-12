import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET(request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = request.headers.get('x-cron-secret')

  if (cronSecret !== process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const today = new Date().toISOString().split('T')[0]
    
    // جلب المستخدمين مع استثمار نشط
    const { data: users, error: usersError } = await supabaseAdmin
      .from('users')
      .select(`
        id,
        active_deposit,
        available_balance,
        tier_id,
        tiers (roi_percentage)
      `)
      .gt('active_deposit', 0)

    if (usersError) throw usersError

    let processed = 0

    for (const user of users) {
      // التحقق من عدم تكرار الحساب
      const { data: existingLog } = await supabaseAdmin
        .from('daily_profit_log')
        .select('id')
        .eq('user_id', user.id)
        .eq('calculated_date', today)
        .maybeSingle()

      if (existingLog) continue

      const roiPercent = user.tiers?.roi_percentage || 2.0
      const dailyProfit = (user.active_deposit * roiPercent) / 100

      if (dailyProfit <= 0) continue

      // تحديث الرصيد
      await supabaseAdmin
        .from('users')
        .update({ 
          available_balance: (user.available_balance || 0) + dailyProfit 
        })
        .eq('id', user.id)

      // تسجيل الربح
      await supabaseAdmin
        .from('daily_profit_log')
        .insert({
          user_id: user.id,
          profit_amount: dailyProfit,
          calculated_date: today,
          roi_percent: roiPercent
        })

      await supabaseAdmin
        .from('transactions')
        .insert({
          user_id: user.id,
          type: 'profit',
          amount: dailyProfit,
          status: 'approved',
          description: `Daily profit ${roiPercent}%`
        })

      processed++
    }

    return NextResponse.json({ success: true, processed, date: today })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
