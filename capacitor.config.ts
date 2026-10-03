import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mani.snakegame',
  appName: 'Snake Premium',
  webDir: 'out',
  plugins: {
    // Capacitor 8: injects correct --safe-area-inset-* CSS variables on Android (read by --sai-* in app/globals.css)
    SystemBars: {
      insetsHandling: 'css',
    },
    FirebaseAuthentication: {
      // Sirf Google login chahiye, isliye baaki providers skip
      providers: ['google.com'],
    },
  },
};

export default config;
