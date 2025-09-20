'use client';

import { ReactNode } from 'react';
import { Header } from './header';
import { Sidebar } from './sidebar';
import { Footer } from './footer';
import { cn } from '@/lib/utils';

interface LayoutProps {
  children: ReactNode;
  className?: string;
  showSidebar?: boolean;
  showFooter?: boolean;
}

export function Layout({ 
  children, 
  className,
  showSidebar = true,
  showFooter = true 
}: LayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <div className={cn('flex', className)}>
        {showSidebar && (
          <aside className="hidden lg:block">
            <Sidebar />
          </aside>
        )}
        
        <main className={cn(
          'flex-1',
          showSidebar && 'lg:pl-64'
        )}>
          {children}
        </main>
      </div>
      
      {showFooter && <Footer />}
    </div>
  );
}
