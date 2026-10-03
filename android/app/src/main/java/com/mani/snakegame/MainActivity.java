package com.mani.snakegame;

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Landscape: let the game use the camera-notch side too. The web UI keeps its buttons clear of it
        // with env(safe-area-inset-left/right), so nothing important is ever hidden behind the cut-out.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        keepBarsTransient();
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
        // Notification shade closed / came back from another app: the web layer re-hides the bars if Notch is OFF
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().evaluateJavascript("window.dispatchEvent(new Event('snake-window-focus'))", null);
        }
    }
}
