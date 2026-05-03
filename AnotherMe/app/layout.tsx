import type { Metadata } from 'next';
import './globals.css';
import 'animate.css';
import 'katex/dist/katex.min.css';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { I18nProvider } from '@/lib/hooks/use-i18n';
import { Toaster } from '@/components/ui/sonner';
import { ServerProvidersInit } from '@/components/layout/server-providers-init';
import { AuthProvider } from '@/features/auth/components/auth-provider';

export const metadata: Metadata = {
  title: '镜我 - AI 教育平台',
  description: 'AI 驱动的教育平台，用于创建互动课堂和解答问题。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <ThemeProvider>
          <AuthProvider>
            <I18nProvider>
              <ServerProvidersInit />
              {children}
              <Toaster position="top-center" />
            </I18nProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
