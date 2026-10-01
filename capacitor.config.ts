import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mani.snakegame',
  appName: 'Snake Premium',
  webDir: 'out',
  plugins: {
    FirebaseAuthentication: {
      // Sirf Google login chahiye, isliye baaki providers skip
      providers: ['google.com'],
    },
  },
};

export default config;
