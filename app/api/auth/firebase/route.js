import { NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase/admin'

export async function POST(request) {
  const { token } = await request.json()
  try {
    const decoded = await adminAuth.verifyIdToken(token)
    return NextResponse.json({ user: decoded })
  } catch (error) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }
}
