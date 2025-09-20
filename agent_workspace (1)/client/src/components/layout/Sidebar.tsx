'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Home,
  TrendingUp,
  Clock,
  ThumbsUp,
  PlaySquare,
  Users,
  Music,
  Gamepad2,
  Trophy,
  Lightbulb,
  Settings,
  HelpCircle,
  Flag,
} from 'lucide-react';

const mainNavItems = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/trending', label: 'Trending', icon: TrendingUp },
  { href: '/subscriptions', label: 'Subscriptions', icon: Users },
];

const libraryItems = [
  { href: '/history', label: 'History', icon: Clock },
  { href: '/liked', label: 'Liked videos', icon: ThumbsUp },
  { href: '/playlists', label: 'Playlists', icon: PlaySquare },
];

const exploreItems = [
  { href: '/explore/music', label: 'Music', icon: Music },
  { href: '/explore/gaming', label: 'Gaming', icon: Gamepad2 },
  { href: '/explore/sports', label: 'Sports', icon: Trophy },
  { href: '/explore/learning', label: 'Learning', icon: Lightbulb },
];

const moreItems = [
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/help', label: 'Help', icon: HelpCircle },
  { href: '/feedback', label: 'Send feedback', icon: Flag },
];

interface SidebarProps {
  isOpen?: boolean;
}

export function Sidebar({ isOpen = true }: SidebarProps) {
  const pathname = usePathname();

  const renderNavSection = (items: typeof mainNavItems, title?: string) => (
    <div className="space-y-1">
      {title && (
        <h3 className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          {title}
        </h3>
      )}
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors duration-150 ease-in-out',
              isActive
                ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100'
            )}
          >
            <Icon className="w-5 h-5 mr-3" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );

  if (!isOpen) {
    return null;
  }

  return (
    <aside className="fixed left-0 top-16 h-[calc(100vh-4rem)] w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 overflow-y-auto z-30">
      <nav className="p-4 space-y-6">
        {renderNavSection(mainNavItems)}
        <hr className="border-gray-200 dark:border-gray-700" />
        {renderNavSection(libraryItems, 'Library')}
        <hr className="border-gray-200 dark:border-gray-700" />
        {renderNavSection(exploreItems, 'Explore')}
        <hr className="border-gray-200 dark:border-gray-700" />
        {renderNavSection(moreItems, 'More from ViewmaXX')}
      </nav>
    </aside>
  );
}
