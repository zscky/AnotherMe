'use client';

import { Bell, Search, Calendar } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/features/auth/components/auth-provider';

export function Header() {
  const { user } = useAuth();
  const avatarSeed = user?.id || 'user1';

  return (
    <header className="h-24 flex items-center justify-between px-8 sticky top-0 z-10">
      <div className="flex-1 max-w-md">
        <div className="relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 group-focus-within:text-gray-900 dark:group-focus-within:text-gray-100 transition-colors" />
          <input
            type="text"
            placeholder="搜索..."
            className="w-full pl-11 pr-4 py-2.5 bg-white dark:bg-slate-900 border-none focus:ring-2 focus:ring-gray-200 dark:focus:ring-slate-700 rounded-lg outline-none transition-all duration-300 text-sm shadow-sm text-gray-900 dark:text-gray-100"
          />
        </div>
      </div>

      <div className="flex items-center gap-6">
        <Link href="/notifications" className="text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white transition-colors relative">
          <Bell className="h-5 w-5" />
        </Link>
        
        <Link href="/calendar" className="text-gray-900 dark:text-gray-100 hover:text-black dark:hover:text-white transition-colors relative">
          <Calendar className="h-5 w-5" />
          <span className="absolute -bottom-1 -right-1 h-3 w-3 bg-black text-white text-[8px] font-bold flex items-center justify-center rounded-sm">
            8
          </span>
        </Link>

        <div className="flex items-center ml-2">
          <div className="flex -space-x-2">
            <div className="h-8 w-8 rounded-full border-2 border-[#F3F2EE] dark:border-slate-950 overflow-hidden bg-gray-200 z-10">
              <Image
                src={`https://picsum.photos/seed/${encodeURIComponent(avatarSeed)}/100/100`}
                alt={user?.displayName || 'User'}
                width={32}
                height={32}
                loading="eager"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="h-8 w-8 rounded-full border-2 border-[#F3F2EE] dark:border-slate-950 bg-white dark:bg-slate-800 flex items-center justify-center text-xs font-bold text-gray-900 dark:text-gray-100 z-0">
              {user?.displayName?.slice(0, 1) || '+'}
            </div>
          </div>
        </div>

        <button className="ml-2 bg-[#E0573D] hover:bg-[#c94d35] text-white px-4 py-2.5 rounded-md text-sm font-medium transition-colors shadow-sm">
          添加成员
        </button>
      </div>
    </header>
  );
}
