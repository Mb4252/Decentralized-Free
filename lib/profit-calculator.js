import { supabaseAdmin } from '@/lib/supabase/admin'

export async function calculateDailyProfits() {
  const today = new Date().toISOString().split('T')[0]
  const results = {
    processed: 0,
    skipped: 0,
    errors: 0,
    details: []
  }
  
  try {
    // جلب جميع المستخدمين مع مستوياتهم
    const { data: users, error: usersError } = await supabaseAdmin
      .from('users')
      .select(`
        id,
        active_deposit,
        tier_id,
        tiers (roi_percentage)
      `)
      .gt('active_deposit', 0)
    
    if (usersError) throw usersError
    
    for (const user of users) {
      try {
        // التحقق من عدم احتساب أرباح اليوم
        const { data: existingLog, error: logError } = await supabaseAdmin
          .from('daily_profit_log')
          .select('id')
          .eq('user_id', user.id)
          .eq('calculated_date', today)
          .maybeSingle()
        
        if (existingLog) {
          results.skipped++
          results.details.push({ userId: user.id, status: 'skipped', reason: 'Already calculated today' })
          continue
        }
        
        const roiPercent = user.tiers?.roi_percentage || 2.0
        const dailyProfit = (user.active_deposit * roiPercent) / 100
        
        if (dailyProfit <= 0) {
          results.skipped++
          continue
        }
        
        // استدعاء دالة SQL
        const { error: profitError } = await supabaseAdmin.rpc('add_daily_profit', {
          p_user_id: user.id,
          p_profit: dailyProfit,
          p_date: today,
          p_roi_percent: roiPercent
        })
        
        if (profitError) throw profitError
        
        results.processed++
        results.details.push({ 
          userId: user.id, 
          status: 'success', 
          profit: dailyProfit,
          roiPercent 
        })
        
      } catch (userError) {
        results.errors++
        results.details.push({ userId: user.id, status: 'error', error: userError.message })
        console.error(`Error processing user ${user.id}:`, userError)
      }
    }
    
    // تسجيل النتائج
    await supabaseAdmin
      .from('notifications')
      .insert({
        user_id: null, // نظامي
        title: 'Daily Profit Calculation',
        message: `Processed: ${results.processed}, Skipped: ${results.skipped}, Errors: ${results.errors}`,
        type: 'system'
      })
    
    return results
    
  } catch (error) {
    console.error('Daily profit calculation error:', error)
    throw error
  }
}
