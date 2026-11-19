import type { Metadata } from 'next';
import './globals.css';
import { WalletProvider } from '@/lib/context';
import NavBar from '@/components/NavBar';

export const metadata: Metadata = {
  title: 'نظام الجدارة الزمنية والتعاون الحي',
  description: 'نظام مالي لامركزي قائم على ساعات العطاء البشري',
  manifest: '/manifest.json',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen bg-gradient-to-br from-chronos-50 to-chronos-100 text-slate-800">
        <WalletProvider>
          <NavBar />
          <main className="max-w-4xl mx-auto p-4 pb-24">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
