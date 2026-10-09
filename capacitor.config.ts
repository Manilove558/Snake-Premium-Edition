import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mani.snakegame',
  appName: 'Snake Premium',
  webDir: 'out',
  android: {
    allowMixedContent: true,
  },
  plugins: {

    // MainActivity owns the window insets (WebView fills the WHOLE screen incl. the camera cut-out) and hands the real sizes
    // to the page as --safe-area-inset-* CSS variables. 'disable' stops Capacitor from also padding the window, which is what
    // left a white strip beside the camera hole. The Notch setting in the game decides whether the UI keeps clear of the insets.
    SystemBars: {
      insetsHandling: 'disable',
    },
    FirebaseAuthentication: {
      // Sirf Google login chahiye, isliye baaki providers skip
      providers: ['google.com'],
    },
  },
};

export default config;
