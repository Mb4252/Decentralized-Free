'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '@/lib/context';

export function NavBar() {
  const pathname = usePathname() || '/';
  const { nodeStatus, matches } = useApp();

  const links = [
    { href: '/', label: 'الرئيسية', icon: '🏠' },
    { href: '/prices', label: 'الأسعار', icon: '📊' },
    { href: '/barter', label: 'المقايضة', icon: '🤝', badge: matches.length },
    { href: '/add', label: 'إضافة', icon: '➕' },
  ];

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/' || pathname === '';
    return pathname.startsWith(href);
  };

  return (
    <>
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-md mx-auto px-4 py-2.5 flex items-center justify-between">
          <Link href="/" className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
            <span>📡</span>
            <span>رادار السعر العادل</span>
          </Link>
          <span
            className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
              nodeStatus.mode === 'webrtc-mesh'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-slate-100 text-slate-600 border border-slate-200'
            }`}
          >
            {nodeStatus.mode === 'webrtc-mesh'
              ? `P2P متصل (${nodeStatus.connectedPeers})`
              : 'عقدة محلية'}
          </span>
        </div>
      </header>

      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200">
        <div className="max-w-md mx-auto grid grid-cols-4">
          {links.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex flex-col items-center justify-center py-2 text-xs transition ${
                  active ? 'text-emerald-700 font-bold' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <span className="text-base leading-none mb-1">{item.icon}</span>
                <span>{item.label}</span>
                {typeof item.badge === 'number' && item.badge > 0 && (
                  <span className="absolute top-1.5 right-6 bg-emerald-600 text-white text-[10px] leading-none px-1.5 py-0.5 rounded-full">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

export default NavBar;
