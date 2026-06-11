import { calculateDailyProfits } from '@/lib/profit-calculator'
import { NextResponse } from 'next/server'

export async function GET(request) {
  // التحقق من cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = request.headers.get('x-cron-secret')
  
  if (cronSecret !== process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  try {
    const results = await calculateDailyProfits()
    
    return NextResponse.json({
      success: true,
      results,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
