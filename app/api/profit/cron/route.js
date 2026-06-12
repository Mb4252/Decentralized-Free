import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET(request) {
  // التحقق من الصلاحية
  const authHeader = request.headers.get('authorization')
  const cronSecret = request.headers.get('x-cron-secret')

  if (cronSecret !== process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const today = new Date().toISOString().split('T')[0]
    
    // جلب المستخدمين مع استثمار نشط ومستوياتهم
    const { data: users, error: usersError } = await supabaseAdmin
      .from('users')
      .select(`
        id,
        active_deposit,
        available_balance,
        tier_id,
        tiers (
          roi_percentage
        )
      `)
      .gt('active_deposit', 0)

    if (usersError) {
      console.error('Error fetching users:', usersError)
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
    }

    let processed = 0
    let skipped = 0

    for (const user of users) {
      try {
        // التحقق من عدم حساب الأرباح لليوم
        const { data: existingLog } = await supabaseAdmin
          .from('daily_profit_log')
          .select('id')
          .eq('user_id', user.id)
          .eq('calculated_date', today)
          .maybeSingle()

        if (existingLog) {
          skipped++
          continue
        }

        const roiPercent = user.tiers?.roi_percentage || 2.0
        const dailyProfit = (user.active_deposit * roiPercent) / 100

        if (dailyProfit <= 0) {
          skipped++
          continue
        }

        // 1. تحديث رصيد المستخدم
        const { error: updateError } = await supabaseAdmin
          .from('users')
          .update({ 
            available_balance: (user.available_balance || 0) + dailyProfit 
          })
          .eq('id', user.id)

        if (updateError) throw updateError

        // 2. تسجيل الربح في daily_profit_log
        const { error: logError } = await supabaseAdmin
          .from('daily_profit_log')
          .insert({
            user_id: user.id,
            profit_amount: dailyProfit,
            calculated_date: today,
            roi_percent: roiPercent
          })

        if (logError) throw logError

        // 3. تسجيل المعاملة
        const { error: transactionError } = await supabaseAdmin
          .from('transactions')
          .insert({
            user_id: user.id,
            type: 'profit',
            amount: dailyProfit,
            status: 'approved',
            description: `Daily profit ${roiPercent}% on active deposit`
          })

        if (transactionError) throw transactionError

        processed++
      } catch (userError) {
        console.error(`Error processing user ${user.id}:`, userError)
      }
    }

    return NextResponse.json({
      success: true,
      processed,
      skipped,
      date: today,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Daily profit calculation error:', error)
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 })
  }
}
