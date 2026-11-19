import type { Metadata } from 'next';
import './globals.css';
import { AppProvider } from '@/lib/context';
import NavBar from '@/components/NavBar';

export const metadata: Metadata = {
  title: 'رادار السعر العادل والمقايضة',
  description: 'معرفة السعر العادل للسلع ومقايضتها دون وسيط',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen bg-slate-50 text-slate-800">
        <AppProvider>
          <NavBar />
          <main className="max-w-md mx-auto p-4 pb-24">
            {children}
          </main>
        </AppProvider>
      </body>
    </html>
  );
}
