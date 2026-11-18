package us.redcatx.pinspoof.extension;

import android.annotation.TargetApi;
import android.app.Activity;
import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.pm.Signature;
import android.graphics.Insets;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorManager;
import android.hardware.TriggerEventListener;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import android.view.Display;
import android.view.SurfaceView;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityManager;
import android.webkit.WebView;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Runtime hook targets merged into the patched APK by PinSpoof v1.3.0 Morphe Patch.
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

    private static final Set<String> CLOAKED_PACKAGES = new HashSet<>(Arrays.asList(
            "de.robv.android.xposed.installer",
            "org.lsposed.manager",
            "io.github.lsposed.manager",
            "app.morphe.manager",
            "com.topjohnwu.magisk",
            "us.redcatx.pinspoof"
    ));

    private static final String[] STACK_MARKERS = new String[]{
            "de.robv.android.xposed",
            "LSPHooker",
            "EdHooker",
            "me.weishu.epic",
            "us.redcatx.pinspoof"
    };

    private static volatile boolean spoofedPinned = false;

    private PinSpoofHooks() {
    }

    public static boolean alwaysSpoofPinned() {
        return false;
    }

    public static boolean debugLogging() {
        return false;
    }

    public static boolean cloakPackagesEnabled() {
        return false;
    }

    public static boolean spoofSignatureEnabled() {
        return false;
    }

    public static String originalSignatureHex() {
        return "";
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

    public static String getInstallerPackageName(PackageManager pm, String packageName) {
        log("PackageManager.getInstallerPackageName(" + packageName + ") -> com.android.vending");
        return "com.android.vending";
    }

    public static List<PackageInfo> getInstalledPackages(PackageManager pm, int flags) {
        if (pm == null) {
            return Collections.emptyList();
        }
        List<PackageInfo> raw = pm.getInstalledPackages(flags);
        List<PackageInfo> out = new ArrayList<>(raw.size());
        for (PackageInfo info : raw) {
            if (info == null || !CLOAKED_PACKAGES.contains(info.packageName)) {
                out.add(info);
            }
        }
        return out;
    }

    public static List<ApplicationInfo> getInstalledApplications(PackageManager pm, int flags) {
        if (pm == null) {
            return Collections.emptyList();
        }
        List<ApplicationInfo> raw = pm.getInstalledApplications(flags);
        List<ApplicationInfo> out = new ArrayList<>(raw.size());
        for (ApplicationInfo info : raw) {
            if (info == null || !CLOAKED_PACKAGES.contains(info.packageName)) {
                out.add(info);
            }
        }
        return out;
    }

    public static List<ResolveInfo> queryIntentActivities(PackageManager pm, Intent intent, int flags) {
        if (pm == null) {
            return Collections.emptyList();
        }
        List<ResolveInfo> raw = pm.queryIntentActivities(intent, flags);
        List<ResolveInfo> out = new ArrayList<>(raw.size());
        for (ResolveInfo info : raw) {
            String pkg = info != null && info.activityInfo != null ? info.activityInfo.packageName : null;
            if (pkg == null || !CLOAKED_PACKAGES.contains(pkg)) {
                out.add(info);
            }
        }
        return out;
    }

    public static PackageInfo getPackageInfo(PackageManager pm, String packageName, int flags)
            throws PackageManager.NameNotFoundException {
        if (cloakPackagesEnabled() && packageName != null && CLOAKED_PACKAGES.contains(packageName)) {
            log("Cloaked getPackageInfo() for " + packageName);
            throw new PackageManager.NameNotFoundException(packageName);
        }
        if (pm == null) {
            throw new PackageManager.NameNotFoundException(packageName);
        }
        PackageInfo info = pm.getPackageInfo(packageName, flags);
        if (spoofSignatureEnabled() && info != null) {
            String hex = originalSignatureHex().replace(":", "").replace(" ", "").trim();
            if (hex.length() >= 128) {
                try {
                    info.signatures = new Signature[]{new Signature(hex)};
                    log("Replaced PackageInfo.signatures for " + packageName);
                } catch (Throwable ignored) {
                }
            }
        }
        return info;
    }

    public static StackTraceElement[] getThreadStackTrace(Thread thread) {
        if (thread == null) {
            return new StackTraceElement[0];
        }
        return sanitizeStackTrace(thread.getStackTrace());
    }

    public static StackTraceElement[] getThrowableStackTrace(Throwable throwable) {
        if (throwable == null) {
            return new StackTraceElement[0];
        }
        return sanitizeStackTrace(throwable.getStackTrace());
    }

    private static StackTraceElement[] sanitizeStackTrace(StackTraceElement[] frames) {
        if (frames == null) {
            return new StackTraceElement[0];
        }
        List<StackTraceElement> clean = new ArrayList<>(frames.length);
        for (StackTraceElement frame : frames) {
            if (frame == null) continue;
            String cls = frame.getClassName();
            boolean hide = false;
            if (cls != null) {
                for (String marker : STACK_MARKERS) {
                    if (cls.contains(marker)) {
                        hide = true;
                        break;
                    }
                }
            }
            if (!hide) {
                clean.add(frame);
            }
        }
        return clean.toArray(new StackTraceElement[0]);
    }

    public static void sanitizeSensorEvent(SensorEvent event) {
        if (event == null || event.values == null || event.sensor == null) {
            return;
        }
        int type = event.sensor.getType();
        if (type == Sensor.TYPE_ACCELEROMETER || type == Sensor.TYPE_GRAVITY) {
            if (event.values.length >= 3) {
                event.values[0] = 0f;
                event.values[1] = 0f;
                event.values[2] = SensorManager.GRAVITY_EARTH;
            }
        } else if (type == Sensor.TYPE_GYROSCOPE || type == Sensor.TYPE_LINEAR_ACCELERATION) {
            if (event.values.length >= 3) {
                event.values[0] = 0f;
                event.values[1] = 0f;
                event.values[2] = 0f;
            }
        }
    }

    public static boolean requestTriggerSensor(SensorManager sm, TriggerEventListener listener, Sensor sensor) {
        if (sensor != null && sensor.getType() == Sensor.TYPE_SIGNIFICANT_MOTION) {
            log("Suppressed SensorManager.requestTriggerSensor(TYPE_SIGNIFICANT_MOTION)");
            return false;
        }
        return sm != null && sm.requestTriggerSensor(listener, sensor);
    }

    public static Display[] getDisplays(DisplayManager dm) {
        if (dm == null) {
            return new Display[0];
        }
        return filterDefaultDisplays(dm.getDisplays());
    }

    public static Display[] getDisplays(DisplayManager dm, String category) {
        if (dm == null) {
            return new Display[0];
        }
        return filterDefaultDisplays(dm.getDisplays(category));
    }

    public static Display getDisplay(DisplayManager dm, int displayId) {
        if (displayId != Display.DEFAULT_DISPLAY) {
            log("Blocked secondary DisplayManager.getDisplay(" + displayId + ")");
            return null;
        }
        return dm != null ? dm.getDisplay(displayId) : null;
    }

    private static Display[] filterDefaultDisplays(Display[] displays) {
        if (displays == null || displays.length <= 1) {
            return displays;
        }
        for (Display d : displays) {
            if (d != null && d.getDisplayId() == Display.DEFAULT_DISPLAY) {
                return new Display[]{d};
            }
        }
        return new Display[]{displays[0]};
    }

    public static void onClipboardClear(ClipboardManager cm) {
        log("Blocked ClipboardManager.clearPrimaryClip()");
    }

    public static void onClipboardSetPrimaryClip(ClipboardManager cm, ClipData clip) {
        boolean isEmptyClear = clip == null || clip.getItemCount() == 0;
        if (!isEmptyClear && clip.getItemCount() == 1) {
            CharSequence txt = clip.getItemAt(0).getText();
            if (txt == null || txt.toString().trim().isEmpty()) {
                isEmptyClear = true;
            }
        }
        if (isEmptyClear) {
            log("Blocked empty ClipboardManager.setPrimaryClip() wipe");
            return;
        }
        if (cm != null) {
            cm.setPrimaryClip(clip);
        }
    }

    public static Exception softFailTaskException(Object task) {
        if (task == null) {
            return null;
        }
        try {
            Method m = task.getClass().getMethod("getException");
            Object res = m.invoke(task);
            if (res instanceof Exception) {
                Exception ex = (Exception) res;
                String msg = ex.getClass().getName() + " " + ex.getMessage();
                String lower = msg.toLowerCase();
                if (lower.contains("integrity") || lower.contains("safetynet") || lower.contains("attest")) {
                    log("Soft-failed Integrity/SafetyNet exception: " + ex.getClass().getSimpleName());
                    return null;
                }
                return ex;
            }
        } catch (Throwable ignored) {
        }
        return null;
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
