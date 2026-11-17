package us.redcatx.pinspoof.extension;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ContentResolver;
import android.provider.Settings;
import android.util.Log;
import android.view.View;
import android.webkit.WebView;

/**
 * Runtime hook targets merged into the patched APK by PinSpoof Morphe Patch.
 * Patch-time options (ALWAYS_SPOOF_PINNED, DEBUG_LOGGING, and which hook surfaces
 * are rewritten) are configured via Morphe Manager Patching Options.
 */
@SuppressWarnings({"unused", "deprecation"})
public final class PinSpoofHooks {
    private static final String TAG = "PinSpoof";
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
        log("Blocked ActivityClient/IPC startLockTaskModeByToken call");
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
        log("Activity.hasWindowFocus() -> true");
        return true;
    }

    public static boolean hasWindowFocus(View view) {
        return true;
    }

    public static void getMyMemoryState(ActivityManager.RunningAppProcessInfo outInfo) {
        ActivityManager.getMyMemoryState(outInfo);
        if (outInfo != null) {
            outInfo.importance = ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND;
            log("ActivityManager.getMyMemoryState() -> IMPORTANCE_FOREGROUND");
        }
    }

    public static int filterWindowVisibility(int visibility) {
        if (visibility != View.VISIBLE) {
            log("View/WebView window visibility coerced to View.VISIBLE");
        }
        return View.VISIBLE;
    }

    public static boolean shouldSuppressLifecycle(Activity activity) {
        boolean suppress = activity == null || !activity.isFinishing();
        if (suppress) {
            log("Suppressed Activity pause/stop/Recents transition");
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
