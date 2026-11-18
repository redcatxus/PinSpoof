package us.redcatx.pinspoof.extension;

import android.annotation.TargetApi;
import android.app.Activity;
import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ContentResolver;
import android.content.Context;
import android.graphics.Insets;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import android.view.SurfaceView;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityManager;
import android.webkit.WebView;
import java.util.Collections;
import java.util.List;

/**
 * Runtime hook targets merged into the patched APK by PinSpoof v1.2.0 Morphe Patch.
 * Patch-time options are configured via Morphe Manager / CLI Patching Options.
 */
@SuppressWarnings({"unused", "deprecation"})
public final class PinSpoofHooks {
    private static final String TAG = "PinSpoof";
    private static final String WEBVIEW_STEALTH_JS =
            "(function(){"
                    + "if(window.__pinspoofStealthApplied)return;"
                    + "window.__pinspoofStealthApplied=true;"
                    + "try{"
                    + "Object.defineProperty(document,'hidden',{get:function(){return false;},configurable:true});"
                    + "Object.defineProperty(document,'webkitHidden',{get:function(){return false;},configurable:true});"
                    + "Object.defineProperty(document,'visibilityState',{get:function(){return 'visible';},configurable:true});"
                    + "Object.defineProperty(document,'webkitVisibilityState',{get:function(){return 'visible';},configurable:true});"
                    + "}catch(e){}"
                    + "try{document.hasFocus=function(){return true;};}catch(e){}"
                    + "try{"
                    + "var s=function(e){"
                    + "if(e.type==='blur'&&e.target!==window&&e.target!==document)return;"
                    + "e.stopImmediatePropagation();"
                    + "};"
                    + "window.addEventListener('blur',s,true);"
                    + "document.addEventListener('visibilitychange',s,true);"
                    + "document.addEventListener('webkitvisibilitychange',s,true);"
                    + "}catch(e){}"
                    + "})();";

    private static volatile boolean spoofedPinned = false;

    private PinSpoofHooks() {
    }

    /**
     * Overridden at patch time via PinSpoofPatch ("Always Spoof Pinned" option).
     */
    public static boolean alwaysSpoofPinned() {
        return false;
    }

    /**
     * Overridden at patch time via PinSpoofPatch ("Verbose Debug Logging" option).
     */
    public static boolean debugLogging() {
        return false;
    }

    public static void log(String message) {
        if (debugLogging()) {
            Log.d(TAG, message);
        }
    }

    public static void startLockTask(Activity activity) {
        spoofedPinned = true;
        log("Blocked real pinning via Activity.startLockTask(); spoofedPinned = true");
    }

    public static void stopLockTask(Activity activity) {
        if (!alwaysSpoofPinned()) {
            spoofedPinned = false;
            log("Intercepted Activity.stopLockTask(); spoofedPinned = false");
        } else {
            log("Intercepted Activity.stopLockTask(); maintaining alwaysSpoofPinned = true");
        }
    }

    public static void onLockTaskTokenCall() {
        spoofedPinned = true;
        log("Blocked ActivityClient/IPC LockTask call");
    }

    public static int getLockTaskModeState(ActivityManager am) {
        if (alwaysSpoofPinned() || spoofedPinned) {
            log("ActivityManager.getLockTaskModeState() -> LOCK_TASK_MODE_PINNED (2)");
            return ActivityManager.LOCK_TASK_MODE_PINNED;
        }
        return am != null ? am.getLockTaskModeState() : ActivityManager.LOCK_TASK_MODE_NONE;
    }

    public static boolean isInLockTaskMode(ActivityManager am) {
        if (alwaysSpoofPinned() || spoofedPinned) {
            log("ActivityManager.isInLockTaskMode() -> true");
            return true;
        }
        return am != null && am.isInLockTaskMode();
    }

    public static boolean hasWindowFocus(Activity activity) {
        return true;
    }

    public static boolean hasWindowFocus(View view) {
        return true;
    }

    public static void getMyMemoryState(ActivityManager.RunningAppProcessInfo outInfo) {
        ActivityManager.getMyMemoryState(outInfo);
        if (outInfo != null) {
            outInfo.importance = ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND;
        }
    }

    public static int filterWindowVisibility(int visibility) {
        if (visibility != View.VISIBLE) {
            log("View/WebView window visibility coerced to View.VISIBLE");
        }
        return View.VISIBLE;
    }

    public static void injectWebViewStealth(final WebView webView) {
        if (webView == null) {
            return;
        }
        webView.post(new Runnable() {
            @Override
            public void run() {
                try {
                    webView.evaluateJavascript(WEBVIEW_STEALTH_JS, null);
                } catch (Throwable ignored) {
                }
            }
        });
    }

    public static boolean shouldSuppressLifecycle(Activity activity) {
        boolean suppress = activity == null || !activity.isFinishing();
        if (suppress) {
            log("Suppressed Activity lifecycle transition");
        }
        return suppress;
    }

    public static boolean shouldSuppressLifecycleEvent(Object lifecycleEvent) {
        if (lifecycleEvent == null) {
            return false;
        }
        String name = lifecycleEvent.toString();
        boolean suppress = "ON_PAUSE".equals(name) || "ON_STOP".equals(name);
        if (suppress) {
            log("Suppressed LifecycleRegistry.handleLifecycleEvent(" + name + ")");
        }
        return suppress;
    }

    public static void onWebViewPause(WebView webView) {
        log("Suppressed WebView.onPause()");
    }

    public static void onWebViewPauseTimers(WebView webView) {
        log("Suppressed WebView.pauseTimers()");
    }

    public static boolean isInMultiWindowMode(Activity activity) {
        return false;
    }

    public static boolean isInPictureInPictureMode(Activity activity) {
        return false;
    }

    @TargetApi(Build.VERSION_CODES.R)
    public static Insets getWindowInsets(WindowInsets wi, int typeMask) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            int systemMask = WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars();
            if ((typeMask & systemMask) != 0) {
                return Insets.NONE;
            }
            if (wi != null) {
                return wi.getInsets(typeMask);
            }
            return Insets.NONE;
        }
        return null;
    }

    @TargetApi(Build.VERSION_CODES.R)
    public static boolean isWindowInsetsVisible(WindowInsets wi, int typeMask) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            int systemMask = WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars();
            if ((typeMask & systemMask) != 0) {
                return false;
            }
            return wi != null && wi.isVisible(typeMask);
        }
        return false;
    }

    public static int getZeroSystemInset(WindowInsets wi) {
        return 0;
    }

    public static void windowSetFlags(Window window, int flags, int mask) {
        if (window == null) {
            return;
        }
        int cleanFlags = flags & ~WindowManager.LayoutParams.FLAG_SECURE;
        int cleanMask = mask & ~WindowManager.LayoutParams.FLAG_SECURE;
        if (cleanMask != 0) {
            window.setFlags(cleanFlags, cleanMask);
        }
        if ((flags & WindowManager.LayoutParams.FLAG_SECURE) != 0) {
            log("Stripped FLAG_SECURE via Window.setFlags()");
        }
    }

    public static void windowAddFlags(Window window, int flags) {
        if (window == null) {
            return;
        }
        int cleanFlags = flags & ~WindowManager.LayoutParams.FLAG_SECURE;
        if (cleanFlags != 0) {
            window.addFlags(cleanFlags);
        }
        if ((flags & WindowManager.LayoutParams.FLAG_SECURE) != 0) {
            log("Stripped FLAG_SECURE via Window.addFlags()");
        }
    }

    public static void surfaceViewSetSecure(SurfaceView surfaceView, boolean isSecure) {
        if (surfaceView != null) {
            surfaceView.setSecure(false);
        }
    }

    public static List<?> getEnabledAccessibilityServiceList(AccessibilityManager am, int feedbackTypeFlags) {
        log("AccessibilityManager.getEnabledAccessibilityServiceList() -> emptyList");
        return Collections.emptyList();
    }

    public static boolean canDrawOverlays(Context context) {
        log("Settings.canDrawOverlays() -> false");
        return false;
    }

    public static boolean shouldSuppressAudioFocusLoss(int focusChange) {
        boolean suppress = focusChange < 0;
        if (suppress) {
            log("Suppressed OnAudioFocusChangeListener(" + focusChange + ")");
        }
        return suppress;
    }

    public static int getSettingsSystemInt(ContentResolver cr, String name, int def) {
        if ("lock_to_app_enabled".equals(name)) {
            log("Settings.System.getInt(lock_to_app_enabled) -> 1");
            return 1;
        }
        return Settings.System.getInt(cr, name, def);
    }

    public static int getSettingsSystemInt(ContentResolver cr, String name)
            throws Settings.SettingNotFoundException {
        if ("lock_to_app_enabled".equals(name)) {
            log("Settings.System.getInt(lock_to_app_enabled) -> 1");
            return 1;
        }
        return Settings.System.getInt(cr, name);
    }

    public static boolean isLockTaskPermitted(DevicePolicyManager dpm, String pkg) {
        log("DevicePolicyManager.isLockTaskPermitted(" + pkg + ") -> true");
        return true;
    }
}
