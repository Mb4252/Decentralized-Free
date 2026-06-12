import { authOptions } from "@/app/api/auth/[...nextauth]/route";

import GoogleProvider from "next-auth/providers/google"
import { supabaseAdmin } from "@/lib/supabase/admin"
import bcrypt from "bcryptjs"

function generateReferralCode() {
    return Math.random().toString(36).substring(2, 10).toUpperCase()
}

export const authOptions = {
    providers: [
        GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        }),
    ],
    callbacks: {
        async signIn({ user, account, profile }) {
            try {
                const { data: existingUser, error: fetchError } = await supabaseAdmin
                    .from('users')
                    .select('id, email')
                    .eq('email', user.email)
                    .single()

                if (!existingUser && !fetchError) {
                    const defaultPin = Math.floor(1000 + Math.random() * 9000).toString()
                    const hashedPin = await bcrypt.hash(defaultPin, 10)

                    const { error: insertError } = await supabaseAdmin
                        .from('users')
                        .insert({
                            email: user.email,
                            name: user.name,
                            withdraw_pin: hashedPin,
                            referral_code: generateReferralCode(),
                            tier_id: 1
                        })

                    if (insertError) {
                        console.error('Error creating user:', insertError)
                        return false
                    }
                    
                    console.log(`New user created: ${user.email} with PIN: ${defaultPin}`)
                }
                
                return true
            } catch (error) {
                console.error('SignIn error:', error)
                return false
            }
        },
        
        async session({ session, token }) {
            if (session?.user?.email) {
                const { data: userData } = await supabaseAdmin
                    .from('users')
                    .select('id, referral_code, tier_id, available_balance, active_deposit')
                    .eq('email', session.user.email)
                    .single()
                
                if (userData) {
                    session.user.id = userData.id
                    session.user.referralCode = userData.referral_code
                    session.user.tierId = userData.tier_id
                    session.user.availableBalance = userData.available_balance
                    session.user.activeDeposit = userData.active_deposit
                }
            }
            return session
        }
    },
    pages: {
        signIn: '/login',
        error: '/login',
    },
    secret: process.env.NEXTAUTH_SECRET,
}

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }
