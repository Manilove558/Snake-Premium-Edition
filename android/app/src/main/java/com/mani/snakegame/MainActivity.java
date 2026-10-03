package com.mani.snakegame;

import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // Latest real system insets in physical pixels (status/nav bars + camera cut-out), handed to the web layer as CSS variables
    private int insTop, insRight, insBottom, insLeft;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Landscape: let the game use the camera-notch side too (the window is allowed to draw into the cut-out)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        installInsetsBridge();
        keepBarsTransient();
        // The page may still be loading on the first insets pass: push again a few times so the CSS variables always land
        for (long delay : new long[] { 300L, 1000L, 2500L }) {
            mainHandler.postDelayed(this::pushInsetsToWeb, delay);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // Re-assert our listener (idempotent) in case a plugin replaced it
        installInsetsBridge();
    }

    /**
     * WE own the window insets (capacitor.config.ts sets SystemBars.insetsHandling = "disable", so Capacitor no longer pads
     * the window). The WebView therefore fills the WHOLE screen, camera cut-out included, and no Android window background
     * ever shows as a bar. The real inset sizes go to the page as --safe-area-inset-* CSS variables; app/globals.css turns
     * them into --sai-* and the "Notch Display" setting decides whether the UI keeps clear of them (ON) or ignores them (OFF).
     */
    private void installInsetsBridge() {
        final View decor = getWindow().getDecorView();
        // API 30+: draw edge-to-edge on every version (35+ already enforces it). Older devices keep the system-fitted window.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        }
        ViewCompat.setOnApplyWindowInsetsListener(decor, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            boolean imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
            int imeBottom = imeVisible ? insets.getInsets(WindowInsetsCompat.Type.ime()).bottom : 0;
            // Keyboard: lift the whole page above it (older WebViews do not resize themselves for the IME)
            v.setPadding(0, 0, 0, imeBottom);
            insTop = bars.top;
            insRight = bars.right;
            insLeft = bars.left;
            insBottom = imeVisible ? 0 : bars.bottom; // the keyboard already covers the nav bar
            pushInsetsToWeb();
            return insets; // never CONSUMED: that breaks the WebView's own env(safe-area-inset-*)
        });
        ViewCompat.requestApplyInsets(decor);
    }

    private void pushInsetsToWeb() {
        if (getBridge() == null) return;
        WebView web = getBridge().getWebView();
        if (web == null) return;
        float d = getResources().getDisplayMetrics().density;
        String js = String.format(
            Locale.US,
            "(function(s){s.setProperty('--safe-area-inset-top','%.2fpx');s.setProperty('--safe-area-inset-right','%.2fpx');"
                + "s.setProperty('--safe-area-inset-bottom','%.2fpx');s.setProperty('--safe-area-inset-left','%.2fpx');})"
                + "(document.documentElement.style);window.dispatchEvent(new Event('snake-insets'));",
            insTop / d, insRight / d, insBottom / d, insLeft / d
        );
        web.evaluateJavascript(js, null);
    }

    /**
     * With the "Notch Display" setting OFF the web layer hides the system bars (full screen). By default Android then
     * shows them again PERMANENTLY after any swipe (notification shade, nav bar, Back ...). "Transient" makes a swipe
     * only peek the bars for a moment; they hide again on their own.
     */
    private void keepBarsTransient() {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus) return;
        keepBarsTransient();
        pushInsetsToWeb();
        // Notification shade closed / came back from another app: the web layer re-hides the bars if Notch is OFF
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().evaluateJavascript("window.dispatchEvent(new Event('snake-window-focus'))", null);
        }
    }
}
