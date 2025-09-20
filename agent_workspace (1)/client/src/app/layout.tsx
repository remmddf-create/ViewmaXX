import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/providers/AuthProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { Toaster } from '@/components/ui/toaster';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'ViewmaXX - Video Sharing Platform',
  description: 'The next generation video sharing platform with advanced features and monetization.',
  keywords: 'video, sharing, streaming, content, creators, monetization',
  authors: [{ name: 'MiniMax Agent' }],
  creator: 'MiniMax Agent',
  openGraph: {
    title: 'ViewmaXX - Video Sharing Platform',
    description: 'The next generation video sharing platform with advanced features and monetization.',
    type: 'website',
    locale: 'en_US',
    url: process.env.NEXT_PUBLIC_CLIENT_URL,
    siteName: 'ViewmaXX',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ViewmaXX - Video Sharing Platform',
    description: 'The next generation video sharing platform with advanced features and monetization.',
    creator: '@viewmaxx',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>
            {children}
            <Toaster />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
