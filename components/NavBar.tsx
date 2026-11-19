'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/', label: 'الرئيسية' },
  { href: '/wallet', label: 'المحفظة' },
  { href: '/send', label: 'تحويل' },
  { href: '/services', label: 'الخدمات' },
  { href: '/ledger', label: 'السجل' },
];

export default function NavBar() {
  const pathname = usePathname();
  return (
    <nav className="bg-white/90 backdrop-blur border-b border-chronos-200 sticky top-0 z-50">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="font-bold text-chronos
