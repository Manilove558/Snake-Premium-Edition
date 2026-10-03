import type { Metadata, Viewport } from 'next'
import { Outfit } from 'next/font/google'
import './globals.css'

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
    <html lang="en" className={outfit.variable}>
      <body className="font-sans">{children}</body>
    </html>
  )
}
