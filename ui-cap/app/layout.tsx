import type { Metadata, Viewport } from 'next'
import { Sora } from 'next/font/google'

import { AppProvider } from '../presentation/deps/AppProvider'
import { NotificationLayer } from '../presentation/overlays/NotificationLayer'
import './globals.css'

/**
 * Sora is the Flots typeface. `next/font` downloads and self-hosts it at build
 * time, which matters here: the robot may well be running with no internet.
 */
const sora = Sora({
  subsets: ['latin'],
  variable: '--font-sora',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
})

export const metadata: Metadata = {
  title: 'Cap',
  description: 'Cap, the Flots assistant, in person.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // A kiosk must not zoom: a stray pinch would leave the panel unusable with
  // nobody around to fix it.
  userScalable: false,
  themeColor: '#615fff',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="fr" className={sora.variable}>
      <body className="h-full w-full">
        <AppProvider>
          {children}
          {/* Alarms and notices reach the user on any screen. */}
          <NotificationLayer />
        </AppProvider>
      </body>
    </html>
  )
}
