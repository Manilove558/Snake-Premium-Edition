import type { Metadata, Viewport } from 'next'
import { Outfit } from 'next/font/google'
import './globals.css'
import { NOTCH_INIT_SCRIPT } from '@/lib/notch'

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' })

export const metadata: Metadata = {
  title: 'Snake — Premium Edition',
  description: 'A premium, mobile-first take on the classic Snake game.',
  applicationName: 'Snake Premium',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Snake Premium',
  },
  manifest: '/manifest.json',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0b0f14' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0f14' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // suppressHydrationWarning: the inline script below sets <html data-notch> before React hydrates
    <html lang="en" className={outfit.variable} suppressHydrationWarning>
      <head>
        {/* Applies the saved Notch setting before the first paint, so a saved OFF never flashes the safe-area layout */}
        <script dangerouslySetInnerHTML={{ __html: NOTCH_INIT_SCRIPT }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  )
}
