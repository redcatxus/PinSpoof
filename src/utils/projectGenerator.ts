import JSZip from 'jszip';
import type { GeneratedFile, ModuleConfig } from '../types/moduleConfig';

function sanitizePackageName(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '');
  if (!cleaned || !cleaned.includes('.')) {
    return 'us.redcatx.pinspoof';
  }
  return cleaned;
}

function parseScopes(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== 'android' && s !== 'system_server');
}

function generateHookConfigKt(config: ModuleConfig, pkg: string): string {
  return `package ${pkg}

/**
 * Compile-time default hook configuration generated for ${config.moduleName} v${config.versionName}.
 * When the Material You settings UI is enabled, runtime overrides from
 * XSharedPreferences take precedence per-app or globally.
 * Never requires scoping to system_server ("android").
 */
object HookConfig {
    const val MODULE_TAG = "${config.moduleName}"
    const val MODULE_PKG = "${pkg}"
    const val PREFS_NAME = "pinspoof_prefs"
    const val STATS_PREFS_NAME = "pinspoof_stats"
    const val STATS_ACTION = "${pkg}.ACTION_HOOK_STATS"

    const val ALWAYS_SPOOF_PINNED = ${config.spoofTiming === 'always'}
    const val HOOK_ACTIVITY_LOCK_TASK = ${config.hookActivityLockTask}
    const val HOOK_ACTIVITY_MANAGER_STATE = ${config.hookActivityManagerState}
    const val HOOK_BINDER_PROXIES = ${config.hookBinderProxies}
    const val HOOK_ACTIVITY_CLIENT = ${config.hookActivityClient}
    const val HOOK_SETTINGS_LOCK_TO_APP = ${config.hookSettingsLockToApp}
    const val HOOK_DPM_LOCK_TASK_PERMITTED = ${config.hookDevicePolicyPermitted}
    const val HIDE_FOCUS_LOSS = ${config.hideFocusLoss}
    const val HIDE_WEBVIEW_VISIBILITY = ${config.hideWebViewVisibility}
    const val HIDE_LIFECYCLE_LOSS = ${config.hideLifecycleLoss}
    const val HIDE_MULTI_WINDOW_PIP = ${config.hideMultiWindowAndPip}
    const val SPOOF_PINNED_INSETS = ${config.spoofPinnedInsets}
    const val STRIP_FLAG_SECURE = ${config.stripFlagSecure}
    const val HIDE_ACCESSIBILITY_OVERLAYS = ${config.hideAccessibilityAndOverlays}
    const val RETAIN_AUDIO_FOCUS = ${config.retainAudioFocus}
    const val DEBUG_LOGGING = ${config.debugLogging}
}
`;
}

function generateStatsReceiverKt(pkg: string): string {
  return `package ${pkg}

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class PinSpoofStatsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != HookConfig.STATS_ACTION) return
        val pkg = intent.getStringExtra("pkg")?.takeIf { it.isNotBlank() } ?: return
        val pinDelta = intent.getLongExtra("pin", 0L).coerceAtLeast(0L)
        val focusDelta = intent.getLongExtra("focus", 0L).coerceAtLeast(0L)
        val lifecycleDelta = intent.getLongExtra("lifecycle", 0L).coerceAtLeast(0L)
        val webviewDelta = intent.getLongExtra("webview", 0L).coerceAtLeast(0L)
        if (pinDelta + focusDelta + lifecycleDelta + webviewDelta == 0L) return

        val prefs = context.getSharedPreferences(HookConfig.STATS_PREFS_NAME, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        prefs.edit()
            .putLong("$pkg::pin", prefs.getLong("$pkg::pin", 0L) + pinDelta)
            .putLong("$pkg::focus", prefs.getLong("$pkg::focus", 0L) + focusDelta)
            .putLong("$pkg::lifecycle", prefs.getLong("$pkg::lifecycle", 0L) + lifecycleDelta)
            .putLong("$pkg::webview", prefs.getLong("$pkg::webview", 0L) + webviewDelta)
            .putLong("$pkg::ts", now)
            .putLong("__all__::pin", prefs.getLong("__all__::pin", 0L) + pinDelta)
            .putLong("__all__::focus", prefs.getLong("__all__::focus", 0L) + focusDelta)
            .putLong("__all__::lifecycle", prefs.getLong("__all__::lifecycle", 0L) + lifecycleDelta)
            .putLong("__all__::webview", prefs.getLong("__all__::webview", 0L) + webviewDelta)
            .putLong("__all__::ts", now)
            .apply()
    }
}
`;
}

function generatePinSpoofModuleKt(config: ModuleConfig, pkg: string): string {
  return `package ${pkg}

import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.app.admin.DevicePolicyManager
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.graphics.Insets
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.SurfaceView
import android.view.View
import android.view.ViewTreeObserver
import android.view.Window
import android.view.WindowInsets
import android.view.WindowManager
import android.view.accessibility.AccessibilityManager
import android.webkit.WebView
import android.webkit.WebViewClient
import de.robv.android.xposed.IXposedHookLoadPackage
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XSharedPreferences
import de.robv.android.xposed.XposedBridge
import de.robv.android.xposed.XposedHelpers
import de.robv.android.xposed.callbacks.XC_LoadPackage.LoadPackageParam
import java.lang.ref.WeakReference
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * ${config.moduleName} v${config.versionName} — App-Scoped LockTask & Focus/UI Stealth Module (Android 7 – 16 / API 24 – 36)
 *
 * Safer v1.2.0 architecture:
 * 1. Reactive mode + safe Window Focus spoofing are ON by default; aggressive lifecycle pause/stop
 *    blocking, WebView visibility/pause suppression, and Binder Stub$Proxy hooks are OFF by default
 *    to prevent SurfaceView black screens, RenderProcessGone crashes, and OEM signature mismatches.
 * 2. Dynamic method-name scanning for ActivityClient & Binder Stub$Proxy with strict error guards.
 * 3. Optional Page Visibility / Fullscreen JS injection for WebView, zeroed pinned WindowInsets
 *    simulation, FLAG_SECURE stripping, accessibility/overlay bypass, audio focus retention, and
 *    throttled live event reporting to the PinSpoof UI.
 */
class PinSpoofModule : IXposedHookLoadPackage {

    private val spoofedPinned = AtomicBoolean(HookConfig.ALWAYS_SPOOF_PINNED)
    private val hookedActivityClasses = ConcurrentHashMap.newKeySet<String>()
    private val hookedWebViewClients = ConcurrentHashMap.newKeySet<String>()
    private val hookedAudioListeners = ConcurrentHashMap.newKeySet<String>()

    private val appContextRef = AtomicReferenceContext()
    private val pendingPinEvents = AtomicLong(0L)
    private val pendingFocusEvents = AtomicLong(0L)
    private val pendingLifecycleEvents = AtomicLong(0L)
    private val pendingWebViewEvents = AtomicLong(0L)
    private val lastFlushMs = AtomicLong(0L)
    private val flushScheduled = AtomicBoolean(false)

    private class AtomicReferenceContext {
        @Volatile
        private var ref: WeakReference<Context>? = null

        fun capture(context: Context?) {
            if (context == null) return
            val appCtx = runCatching { context.applicationContext }.getOrNull() ?: context
            if (ref?.get() == null) {
                ref = WeakReference(appCtx)
            }
        }

        fun get(): Context? = ref?.get()
    }

    private val prefs: XSharedPreferences? by lazy {
        runCatching {
            XSharedPreferences(HookConfig.MODULE_PKG, HookConfig.PREFS_NAME).apply {
                makeWorldReadable()
                reload()
            }
        }.getOrNull()
    }

    private fun readBool(pkg: String, key: String, fallback: Boolean): Boolean {
        val xPrefs = prefs ?: return fallback
        if (xPrefs.hasFileChanged()) {
            xPrefs.reload()
        }
        val hasAppOverride = xPrefs.getBoolean("\${pkg}::override", false)
        return if (hasAppOverride) {
            xPrefs.getBoolean("\${pkg}::$key", fallback)
        } else {
            xPrefs.getBoolean("global::$key", fallback)
        }
    }

    private fun isModuleEnabled(pkg: String): Boolean =
        readBool(pkg, "master_enabled", true)

    private fun isAlwaysPinned(pkg: String): Boolean =
        readBool(pkg, "always_spoof_pinned", HookConfig.ALWAYS_SPOOF_PINNED)

    private fun shouldSpoofAsPinned(pkg: String): Boolean {
        if (!isModuleEnabled(pkg)) return false
        return isAlwaysPinned(pkg) || spoofedPinned.get()
    }

    private fun shouldHideFocus(pkg: String): Boolean =
        isModuleEnabled(pkg) && readBool(pkg, "hide_focus_loss", HookConfig.HIDE_FOCUS_LOSS)

    private fun shouldHideWebView(pkg: String): Boolean =
        isModuleEnabled(pkg) && readBool(pkg, "hide_webview_visibility", HookConfig.HIDE_WEBVIEW_VISIBILITY)

    private fun shouldHideLifecycle(pkg: String): Boolean =
        isModuleEnabled(pkg) && readBool(pkg, "hide_lifecycle_loss", HookConfig.HIDE_LIFECYCLE_LOSS)

    private fun shouldSpoofInsets(pkg: String): Boolean =
        isModuleEnabled(pkg) && readBool(pkg, "spoof_pinned_insets", HookConfig.SPOOF_PINNED_INSETS)

    private fun shouldStripFlagSecure(pkg: String): Boolean =
        isModuleEnabled(pkg) && readBool(pkg, "strip_flag_secure", HookConfig.STRIP_FLAG_SECURE)

    private fun shouldHideAccessibility(pkg: String): Boolean =
        isModuleEnabled(pkg) && readBool(pkg, "hide_accessibility_overlays", HookConfig.HIDE_ACCESSIBILITY_OVERLAYS)

    private fun shouldRetainAudioFocus(pkg: String): Boolean =
        isModuleEnabled(pkg) && readBool(pkg, "retain_audio_focus", HookConfig.RETAIN_AUDIO_FOCUS)

    private fun recordStat(pkg: String, category: String) {
        when (category) {
            "pin" -> pendingPinEvents.incrementAndGet()
            "focus" -> pendingFocusEvents.incrementAndGet()
            "lifecycle" -> pendingLifecycleEvents.incrementAndGet()
            "webview" -> pendingWebViewEvents.incrementAndGet()
        }
        scheduleStatsFlush(pkg)
    }

    private fun scheduleStatsFlush(pkg: String) {
        val ctx = appContextRef.get() ?: return
        val now = SystemClock.elapsedRealtime()
        if (now - lastFlushMs.get() >= 2500L) {
            flushStatsNow(ctx, pkg)
            return
        }
        if (flushScheduled.compareAndSet(false, true)) {
            runCatching {
                Handler(Looper.getMainLooper()).postDelayed({
                    flushScheduled.set(false)
                    appContextRef.get()?.let { flushStatsNow(it, pkg) }
                }, 2500L)
            }
        }
    }

    private fun flushStatsNow(context: Context, pkg: String) {
        val pin = pendingPinEvents.getAndSet(0L)
        val focus = pendingFocusEvents.getAndSet(0L)
        val lifecycle = pendingLifecycleEvents.getAndSet(0L)
        val webview = pendingWebViewEvents.getAndSet(0L)
        if (pin + focus + lifecycle + webview == 0L) return
        lastFlushMs.set(SystemClock.elapsedRealtime())
        runCatching {
            val intent = Intent(HookConfig.STATS_ACTION).apply {
                setPackage(HookConfig.MODULE_PKG)
                putExtra("pkg", pkg)
                putExtra("pin", pin)
                putExtra("focus", focus)
                putExtra("lifecycle", lifecycle)
                putExtra("webview", webview)
            }
            context.sendBroadcast(intent)
        }
    }

    private fun markPinned(pkg: String, source: String) {
        spoofedPinned.set(true)
        recordStat(pkg, "pin")
        log(pkg, "Blocked real pinning via $source; spoofed state = LOCK_TASK_MODE_PINNED (2)")
    }

    private fun markUnpinned(pkg: String, source: String) {
        if (!isAlwaysPinned(pkg)) {
            spoofedPinned.set(false)
            log(pkg, "Intercepted unpin via $source; spoofed state = LOCK_TASK_MODE_NONE (0)")
        } else {
            log(pkg, "Intercepted unpin via $source; maintaining always_spoof_pinned = true")
        }
    }

    private fun log(pkg: String, message: String) {
        if (readBool(pkg, "debug_logging", HookConfig.DEBUG_LOGGING)) {
            XposedBridge.log("[\${HookConfig.MODULE_TAG}][$pkg] $message")
        }
    }

    override fun handleLoadPackage(lpparam: LoadPackageParam) {
        // Never attach to self or system_server even if misconfigured in manager scope
        if (lpparam.packageName == HookConfig.MODULE_PKG || lpparam.packageName == "android") {
            return
        }

        val pkg = lpparam.packageName
        if (!isModuleEnabled(pkg)) {
            log(pkg, "Module disabled for $pkg via granular preferences")
            return
        }

        log(pkg, "Attached to \${lpparam.processName} (SDK \${Build.VERSION.SDK_INT})")
        hookContextCapture(pkg)

        if (readBool(pkg, "hook_activity_lock_task", HookConfig.HOOK_ACTIVITY_LOCK_TASK)) {
            hookActivityLockTask(lpparam)
        }
        if (readBool(pkg, "hook_activity_manager_state", HookConfig.HOOK_ACTIVITY_MANAGER_STATE)) {
            hookActivityManagerState(lpparam)
        }
        if (readBool(pkg, "hook_activity_client", HookConfig.HOOK_ACTIVITY_CLIENT)) {
            hookActivityClient(lpparam)
        }
        if (readBool(pkg, "hook_binder_proxies", HookConfig.HOOK_BINDER_PROXIES)) {
            hookBinderProxies(lpparam)
        }
        if (readBool(pkg, "hide_focus_loss", HookConfig.HIDE_FOCUS_LOSS)) {
            hookFocusLossSpoof(lpparam)
        }
        if (readBool(pkg, "hide_webview_visibility", HookConfig.HIDE_WEBVIEW_VISIBILITY)) {
            hookWebViewStealth(lpparam)
        }
        if (readBool(pkg, "hide_lifecycle_loss", HookConfig.HIDE_LIFECYCLE_LOSS)) {
            hookLifecycleStealth(lpparam)
        }
        if (readBool(pkg, "hide_multi_window_pip", HookConfig.HIDE_MULTI_WINDOW_PIP)) {
            hookMultiWindowAndPip(lpparam)
        }
        if (readBool(pkg, "spoof_pinned_insets", HookConfig.SPOOF_PINNED_INSETS)) {
            hookPinnedWindowInsets(lpparam)
        }
        if (readBool(pkg, "strip_flag_secure", HookConfig.STRIP_FLAG_SECURE)) {
            hookFlagSecureStrip(lpparam)
        }
        if (readBool(pkg, "hide_accessibility_overlays", HookConfig.HIDE_ACCESSIBILITY_OVERLAYS)) {
            hookAccessibilityAndOverlayBypass(lpparam)
        }
        if (readBool(pkg, "retain_audio_focus", HookConfig.RETAIN_AUDIO_FOCUS)) {
            hookAudioFocusRetention(lpparam)
        }
        if (readBool(pkg, "hook_settings_lock_to_app", HookConfig.HOOK_SETTINGS_LOCK_TO_APP)) {
            hookSettingsLockToApp(lpparam)
        }
        if (readBool(pkg, "hook_dpm_permitted", HookConfig.HOOK_DPM_LOCK_TASK_PERMITTED)) {
            hookDevicePolicyPermitted(lpparam)
        }
    }

    private fun hookContextCapture(pkg: String) {
        runCatching {
            XposedBridge.hookAllMethods(
                Application::class.java,
                "onCreate",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        appContextRef.capture(param.thisObject as? Context)
                    }
                }
            )
        }
        runCatching {
            XposedBridge.hookAllMethods(
                Activity::class.java,
                "performCreate",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        val act = param.thisObject as? Activity ?: return
                        appContextRef.capture(act)
                        hookAppActivitySubclass(act.javaClass, pkg)
                    }
                }
            )
        }
    }

    private fun hookActivityLockTask(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        runCatching {
            XposedHelpers.findAndHookMethod(
                Activity::class.java,
                "startLockTask",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (!isModuleEnabled(pkg)) return
                        appContextRef.capture(param.thisObject as? Context)
                        markPinned(pkg, "Activity.startLockTask()")
                        param.result = null
                    }
                }
            )

            XposedHelpers.findAndHookMethod(
                Activity::class.java,
                "stopLockTask",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (!isModuleEnabled(pkg)) return
                        markUnpinned(pkg, "Activity.stopLockTask()")
                        param.result = null
                    }
                }
            )
        }.onFailure {
            log(pkg, "Failed to hook Activity lock task methods: \${it.message}")
        }
    }

    private fun hookActivityManagerState(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        runCatching {
            XposedHelpers.findAndHookMethod(
                ActivityManager::class.java,
                "getLockTaskModeState",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldSpoofAsPinned(pkg)) {
                            param.result = ActivityManager.LOCK_TASK_MODE_PINNED
                            log(pkg, "ActivityManager.getLockTaskModeState() -> LOCK_TASK_MODE_PINNED (2)")
                        }
                    }
                }
            )
        }.onFailure {
            log(pkg, "getLockTaskModeState hook skipped: \${it.message}")
        }

        runCatching {
            @Suppress("DEPRECATION")
            XposedHelpers.findAndHookMethod(
                ActivityManager::class.java,
                "isInLockTaskMode",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldSpoofAsPinned(pkg)) {
                            param.result = true
                            log(pkg, "ActivityManager.isInLockTaskMode() -> true")
                        }
                    }
                }
            )
        }.onFailure {
            log(pkg, "isInLockTaskMode hook skipped: \${it.message}")
        }
    }

    private fun hookActivityClient(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        // Android 12-16 (API 31-36) routes Activity.startLockTask through android.app.ActivityClient.
        // Scan method names dynamically so OEM-customized signatures never throw NoSuchMethodError.
        val activityClientClass = XposedHelpers.findClassIfExists(
            "android.app.ActivityClient",
            lpparam.classLoader
        ) ?: return
        hookDynamicLockTaskMethods(activityClientClass, pkg, "ActivityClient")
    }

    private fun hookBinderProxies(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        listOf(
            "android.app.IActivityTaskManager\\$Stub\\$Proxy" to "IActivityTaskManager",
            "android.app.IActivityManager\\$Stub\\$Proxy" to "IActivityManager"
        ).forEach { (className, label) ->
            val proxyClass = XposedHelpers.findClassIfExists(className, lpparam.classLoader)
            if (proxyClass != null) {
                hookDynamicLockTaskMethods(proxyClass, pkg, label)
            }
        }
    }

    private fun hookDynamicLockTaskMethods(targetClass: Class<*>, pkg: String, label: String) {
        runCatching {
            targetClass.declaredMethods
                .filter { it.name.contains("LockTask", ignoreCase = true) }
                .forEach { method ->
                    runCatching {
                        XposedBridge.hookMethod(
                            method,
                            object : XC_MethodHook() {
                                override fun beforeHookedMethod(param: MethodHookParam) {
                                    val name = method.name
                                    when {
                                        name.startsWith("startLockTask") -> {
                                            if (!isModuleEnabled(pkg)) return
                                            markPinned(pkg, "$label.$name")
                                            param.result = defaultReturnFor(method.returnType)
                                        }
                                        name.startsWith("stopLockTask") -> {
                                            if (!isModuleEnabled(pkg)) return
                                            markUnpinned(pkg, "$label.$name")
                                            param.result = defaultReturnFor(method.returnType)
                                        }
                                        name == "getLockTaskModeState" -> {
                                            if (shouldSpoofAsPinned(pkg)) {
                                                param.result = ActivityManager.LOCK_TASK_MODE_PINNED
                                            }
                                        }
                                        name == "isInLockTaskMode" -> {
                                            if (shouldSpoofAsPinned(pkg)) {
                                                param.result = true
                                            }
                                        }
                                    }
                                }
                            }
                        )
                    }
                }
        }.onFailure {
            log(pkg, "$label dynamic lock-task hook error: \${it.message}")
        }
    }

    private fun defaultReturnFor(returnType: Class<*>): Any? = when (returnType) {
        Boolean::class.javaPrimitiveType, java.lang.Boolean::class.java -> true
        Int::class.javaPrimitiveType, java.lang.Integer::class.java -> 0
        else -> null
    }

    private fun hookFocusLossSpoof(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName

        // 1. Drop View.dispatchWindowFocusChanged(false) before views/listeners see focus loss
        runCatching {
            XposedHelpers.findAndHookMethod(
                View::class.java,
                "dispatchWindowFocusChanged",
                Boolean::class.javaPrimitiveType,
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldHideFocus(pkg) && param.args[0] == false) {
                            recordStat(pkg, "focus")
                            param.result = null
                        }
                    }
                }
            )
        }

        // 2. Drop ViewTreeObserver.dispatchOnWindowFocusChange(false)
        runCatching {
            XposedBridge.hookAllMethods(
                ViewTreeObserver::class.java,
                "dispatchOnWindowFocusChange",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldHideFocus(pkg) && param.args.isNotEmpty() && param.args[0] == false) {
                            param.result = null
                        }
                    }
                }
            )
        }

        // 3. Intercept DecorView.onWindowFocusChanged(false)
        val decorViewClass = XposedHelpers.findClassIfExists(
            "com.android.internal.policy.DecorView",
            lpparam.classLoader
        )
        if (decorViewClass != null) {
            runCatching {
                XposedBridge.hookAllMethods(
                    decorViewClass,
                    "onWindowFocusChanged",
                    object : XC_MethodHook() {
                        override fun beforeHookedMethod(param: MethodHookParam) {
                            if (shouldHideFocus(pkg) && param.args.isNotEmpty() && param.args[0] == false) {
                                log(pkg, "Suppressed DecorView.onWindowFocusChanged(false)")
                                param.result = null
                            }
                        }
                    }
                )
            }
        }

        // 4. Intercept Activity.onWindowFocusChanged(false) & Activity.hasWindowFocus()
        runCatching {
            XposedHelpers.findAndHookMethod(
                Activity::class.java,
                "onWindowFocusChanged",
                Boolean::class.javaPrimitiveType,
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldHideFocus(pkg) && param.args[0] == false) {
                            recordStat(pkg, "focus")
                            param.args[0] = true
                        }
                    }
                }
            )
            XposedHelpers.findAndHookMethod(
                Activity::class.java,
                "hasWindowFocus",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldHideFocus(pkg)) {
                            param.result = true
                        }
                    }
                }
            )
        }

        // 5. Force View.hasWindowFocus() -> true
        runCatching {
            XposedHelpers.findAndHookMethod(
                View::class.java,
                "hasWindowFocus",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldHideFocus(pkg)) {
                            param.result = true
                        }
                    }
                }
            )
        }

        // 6. Android 10-16: suppress onTopResumedActivityChanged(false)
        runCatching {
            XposedBridge.hookAllMethods(
                Activity::class.java,
                "performTopResumedActivityChanged",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldHideFocus(pkg) && param.args.isNotEmpty() && param.args[0] == false) {
                            recordStat(pkg, "focus")
                            log(pkg, "Suppressed performTopResumedActivityChanged(false)")
                            param.result = null
                        }
                    }
                }
            )
        }

        // 7. Safe Recents/Home hint suppression (does NOT block Activity.onPause/onStop surfaces)
        runCatching {
            XposedBridge.hookAllMethods(
                Activity::class.java,
                "performUserLeaving",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldHideFocus(pkg)) {
                            recordStat(pkg, "focus")
                            log(pkg, "Suppressed Activity.performUserLeaving() safely")
                            param.result = null
                        }
                    }
                }
            )
        }

        // 8. Spoof ActivityManager.getMyMemoryState() so process importance stays IMPORTANCE_FOREGROUND
        runCatching {
            XposedHelpers.findAndHookMethod(
                ActivityManager::class.java,
                "getMyMemoryState",
                ActivityManager.RunningAppProcessInfo::class.java,
                object : XC_MethodHook() {
                    override fun afterHookedMethod(param: MethodHookParam) {
                        if (!shouldHideFocus(pkg)) return
                        val outInfo = param.args[0] as? ActivityManager.RunningAppProcessInfo ?: return
                        outInfo.importance = ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
                    }
                }
            )
        }
    }

    private fun hookWebViewStealth(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        val webViewClass = XposedHelpers.findClassIfExists(
            "android.webkit.WebView",
            lpparam.classLoader
        ) ?: return

        // 1. Keep WebView window visibility reporting View.VISIBLE
        runCatching {
            XposedBridge.hookAllMethods(
                webViewClass,
                "onWindowVisibilityChanged",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldHideWebView(pkg) && param.args.isNotEmpty() && param.args[0] != View.VISIBLE) {
                            recordStat(pkg, "webview")
                            param.args[0] = View.VISIBLE
                        }
                    }
                }
            )
        }

        // 2. Optionally block WebView.onPause() / pauseTimers() for stubborn players/timers
        runCatching {
            XposedBridge.hookAllMethods(
                webViewClass,
                "onPause",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldHideWebView(pkg)) {
                            recordStat(pkg, "webview")
                            log(pkg, "Suppressed WebView.onPause()")
                            param.result = null
                        }
                    }
                }
            )
            XposedBridge.hookAllMethods(
                webViewClass,
                "pauseTimers",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldHideWebView(pkg)) {
                            recordStat(pkg, "webview")
                            log(pkg, "Suppressed WebView.pauseTimers()")
                            param.result = null
                        }
                    }
                }
            )
        }

        // 3. Inject DOM Page Visibility & Fullscreen stealth JS on WebView page completion
        runCatching {
            XposedBridge.hookAllMethods(
                WebViewClient::class.java,
                "onPageFinished",
                object : XC_MethodHook() {
                    override fun afterHookedMethod(param: MethodHookParam) {
                        val view = param.args.firstOrNull() as? WebView ?: return
                        if (shouldHideWebView(pkg)) {
                            injectWebViewStealthJs(view, pkg)
                        }
                    }
                }
            )
        }

        runCatching {
            XposedBridge.hookAllMethods(
                webViewClass,
                "setWebViewClient",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        val client = param.args.firstOrNull() as? WebViewClient ?: return
                        val clsName = client.javaClass.name
                        if (hookedWebViewClients.add(clsName)) {
                            runCatching {
                                XposedBridge.hookAllMethods(
                                    client.javaClass,
                                    "onPageFinished",
                                    object : XC_MethodHook() {
                                        override fun afterHookedMethod(p: MethodHookParam) {
                                            val view = p.args.firstOrNull() as? WebView ?: return
                                            if (shouldHideWebView(pkg)) {
                                                injectWebViewStealthJs(view, pkg)
                                            }
                                        }
                                    }
                                )
                            }
                        }
                    }
                }
            )
        }

        runCatching {
            XposedBridge.hookAllMethods(
                webViewClass,
                "onAttachedToWindow",
                object : XC_MethodHook() {
                    override fun afterHookedMethod(param: MethodHookParam) {
                        val view = param.thisObject as? WebView ?: return
                        if (shouldHideWebView(pkg)) {
                            injectWebViewStealthJs(view, pkg)
                        }
                    }
                }
            )
        }
    }

    private fun injectWebViewStealthJs(webView: WebView, pkg: String) {
        runCatching {
            webView.post {
                runCatching {
                    webView.evaluateJavascript(WEBVIEW_STEALTH_JS, null)
                    recordStat(pkg, "webview")
                }
            }
        }
    }

    private fun hookLifecycleStealth(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName

        // Suppress Application.ActivityLifecycleCallbacks paused/stopped dispatches
        runCatching {
            XposedBridge.hookAllMethods(
                Application::class.java,
                "dispatchActivityPaused",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        val act = param.args.firstOrNull() as? Activity
                        if (shouldHideLifecycle(pkg) && act?.isFinishing != true) {
                            recordStat(pkg, "lifecycle")
                            param.result = null
                        }
                    }
                }
            )
            XposedBridge.hookAllMethods(
                Application::class.java,
                "dispatchActivityStopped",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        val act = param.args.firstOrNull() as? Activity
                        if (shouldHideLifecycle(pkg) && act?.isFinishing != true) {
                            recordStat(pkg, "lifecycle")
                            param.result = null
                        }
                    }
                }
            )
        }

        // Suppress Jetpack LifecycleRegistry ON_PAUSE / ON_STOP
        val lifecycleRegistryClass = XposedHelpers.findClassIfExists(
            "androidx.lifecycle.LifecycleRegistry",
            lpparam.classLoader
        )
        if (lifecycleRegistryClass != null) {
            runCatching {
                XposedBridge.hookAllMethods(
                    lifecycleRegistryClass,
                    "handleLifecycleEvent",
                    object : XC_MethodHook() {
                        override fun beforeHookedMethod(param: MethodHookParam) {
                            if (!shouldHideLifecycle(pkg)) return
                            val eventName = param.args.firstOrNull()?.toString() ?: return
                            if (eventName == "ON_PAUSE" || eventName == "ON_STOP") {
                                recordStat(pkg, "lifecycle")
                                log(pkg, "Suppressed LifecycleRegistry.handleLifecycleEvent($eventName)")
                                param.result = null
                            }
                        }
                    }
                )
            }
        }
    }

    private fun hookAppActivitySubclass(startClass: Class<*>, pkg: String) {
        var cls: Class<*>? = startClass
        while (cls != null && cls != Activity::class.java) {
            val name = cls.name
            val isFramework = name.startsWith("android.") ||
                name.startsWith("androidx.") ||
                name.startsWith("com.android.") ||
                name.startsWith("java.")
            if (!isFramework && hookedActivityClasses.add(name)) {
                runCatching {
                    val onPause = cls.getDeclaredMethod("onPause")
                    XposedBridge.hookMethod(onPause, object : XC_MethodHook() {
                        override fun beforeHookedMethod(param: MethodHookParam) {
                            val act = param.thisObject as? Activity ?: return
                            if (shouldHideLifecycle(pkg) && !act.isFinishing) {
                                XposedHelpers.setBooleanField(act, "mCalled", true)
                                recordStat(pkg, "lifecycle")
                                log(pkg, "Suppressed $name.onPause()")
                                param.result = null
                            }
                        }
                    })
                }
                runCatching {
                    val onStop = cls.getDeclaredMethod("onStop")
                    XposedBridge.hookMethod(onStop, object : XC_MethodHook() {
                        override fun beforeHookedMethod(param: MethodHookParam) {
                            val act = param.thisObject as? Activity ?: return
                            if (shouldHideLifecycle(pkg) && !act.isFinishing) {
                                XposedHelpers.setBooleanField(act, "mCalled", true)
                                recordStat(pkg, "lifecycle")
                                log(pkg, "Suppressed $name.onStop()")
                                param.result = null
                            }
                        }
                    })
                }
                runCatching {
                    val onUserLeaveHint = cls.getDeclaredMethod("onUserLeaveHint")
                    XposedBridge.hookMethod(onUserLeaveHint, object : XC_MethodHook() {
                        override fun beforeHookedMethod(param: MethodHookParam) {
                            if (shouldHideFocus(pkg) || shouldHideLifecycle(pkg)) {
                                recordStat(pkg, "focus")
                                log(pkg, "Suppressed $name.onUserLeaveHint()")
                                param.result = null
                            }
                        }
                    })
                }
                runCatching {
                    val onFocusChanged = cls.getDeclaredMethod(
                        "onWindowFocusChanged",
                        Boolean::class.javaPrimitiveType
                    )
                    XposedBridge.hookMethod(onFocusChanged, object : XC_MethodHook() {
                        override fun beforeHookedMethod(param: MethodHookParam) {
                            if (shouldHideFocus(pkg) && param.args[0] == false) {
                                recordStat(pkg, "focus")
                                log(pkg, "Suppressed $name.onWindowFocusChanged(false)")
                                param.result = null
                            }
                        }
                    })
                }
            }
            cls = cls.superclass
        }
    }

    private fun hookMultiWindowAndPip(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            runCatching {
                XposedHelpers.findAndHookMethod(
                    Activity::class.java,
                    "isInMultiWindowMode",
                    object : XC_MethodHook() {
                        override fun beforeHookedMethod(param: MethodHookParam) {
                            if (readBool(pkg, "hide_multi_window_pip", HookConfig.HIDE_MULTI_WINDOW_PIP)) {
                                param.result = false
                            }
                        }
                    }
                )
                XposedHelpers.findAndHookMethod(
                    Activity::class.java,
                    "isInPictureInPictureMode",
                    object : XC_MethodHook() {
                        override fun beforeHookedMethod(param: MethodHookParam) {
                            if (readBool(pkg, "hide_multi_window_pip", HookConfig.HIDE_MULTI_WINDOW_PIP)) {
                                param.result = false
                            }
                        }
                    }
                )
            }
        }
    }

    private fun hookPinnedWindowInsets(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            runCatching {
                XposedHelpers.findAndHookMethod(
                    WindowInsets::class.java,
                    "getInsets",
                    Int::class.javaPrimitiveType,
                    object : XC_MethodHook() {
                        override fun beforeHookedMethod(param: MethodHookParam) {
                            if (!shouldSpoofInsets(pkg)) return
                            val typeMask = param.args[0] as? Int ?: return
                            val systemBarsMask = WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars()
                            if ((typeMask and systemBarsMask) != 0) {
                                param.result = Insets.NONE
                            }
                        }
                    }
                )
                XposedHelpers.findAndHookMethod(
                    WindowInsets::class.java,
                    "isVisible",
                    Int::class.javaPrimitiveType,
                    object : XC_MethodHook() {
                        override fun beforeHookedMethod(param: MethodHookParam) {
                            if (!shouldSpoofInsets(pkg)) return
                            val typeMask = param.args[0] as? Int ?: return
                            val systemBarsMask = WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars()
                            if ((typeMask and systemBarsMask) != 0) {
                                param.result = false
                            }
                        }
                    }
                )
            }
        }

        listOf(
            "getSystemWindowInsetTop",
            "getSystemWindowInsetBottom",
            "getSystemWindowInsetLeft",
            "getSystemWindowInsetRight"
        ).forEach { methodName ->
            runCatching {
                @Suppress("DEPRECATION")
                XposedHelpers.findAndHookMethod(
                    WindowInsets::class.java,
                    methodName,
                    object : XC_MethodHook() {
                        override fun beforeHookedMethod(param: MethodHookParam) {
                            if (shouldSpoofInsets(pkg)) {
                                param.result = 0
                            }
                        }
                    }
                )
            }
        }
    }

    private fun hookFlagSecureStrip(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        runCatching {
            XposedHelpers.findAndHookMethod(
                Window::class.java,
                "setFlags",
                Int::class.javaPrimitiveType,
                Int::class.javaPrimitiveType,
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (!shouldStripFlagSecure(pkg)) return
                        val flags = param.args[0] as? Int ?: return
                        val mask = param.args[1] as? Int ?: return
                        if ((flags and WindowManager.LayoutParams.FLAG_SECURE) != 0 ||
                            (mask and WindowManager.LayoutParams.FLAG_SECURE) != 0
                        ) {
                            param.args[0] = flags and WindowManager.LayoutParams.FLAG_SECURE.inv()
                            param.args[1] = mask and WindowManager.LayoutParams.FLAG_SECURE.inv()
                            log(pkg, "Stripped FLAG_SECURE from Window.setFlags()")
                        }
                    }
                }
            )
            XposedHelpers.findAndHookMethod(
                SurfaceView::class.java,
                "setSecure",
                Boolean::class.javaPrimitiveType,
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldStripFlagSecure(pkg) && param.args[0] == true) {
                            param.args[0] = false
                            log(pkg, "Stripped FLAG_SECURE from SurfaceView.setSecure()")
                        }
                    }
                }
            )
        }
    }

    private fun hookAccessibilityAndOverlayBypass(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        runCatching {
            XposedHelpers.findAndHookMethod(
                AccessibilityManager::class.java,
                "getEnabledAccessibilityServiceList",
                Int::class.javaPrimitiveType,
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldHideAccessibility(pkg)) {
                            param.result = Collections.emptyList<Any>()
                            log(pkg, "AccessibilityManager.getEnabledAccessibilityServiceList() -> emptyList")
                        }
                    }
                }
            )
        }
        runCatching {
            XposedHelpers.findAndHookMethod(
                Settings::class.java,
                "canDrawOverlays",
                Context::class.java,
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldHideAccessibility(pkg)) {
                            param.result = false
                            log(pkg, "Settings.canDrawOverlays() -> false")
                        }
                    }
                }
            )
        }
    }

    private fun hookAudioFocusRetention(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        val hookListenerClass = { listener: Any? ->
            if (listener is AudioManager.OnAudioFocusChangeListener) {
                val cls = listener.javaClass
                if (hookedAudioListeners.add(cls.name)) {
                    runCatching {
                        XposedHelpers.findAndHookMethod(
                            cls,
                            "onAudioFocusChange",
                            Int::class.javaPrimitiveType,
                            object : XC_MethodHook() {
                                override fun beforeHookedMethod(p: MethodHookParam) {
                                    if (!shouldRetainAudioFocus(pkg)) return
                                    val change = p.args[0] as? Int ?: return
                                    if (change < 0) {
                                        log(pkg, "Suppressed audio focus loss ($change) on \${cls.simpleName}")
                                        p.result = null
                                    }
                                }
                            }
                        )
                    }
                }
            }
        }

        runCatching {
            XposedBridge.hookAllMethods(
                AudioManager::class.java,
                "requestAudioFocus",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        param.args.forEach(hookListenerClass)
                    }
                }
            )
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val builderClass = XposedHelpers.findClassIfExists(
                "android.media.AudioFocusRequest\\$Builder",
                lpparam.classLoader
            )
            if (builderClass != null) {
                runCatching {
                    XposedBridge.hookAllMethods(
                        builderClass,
                        "setOnAudioFocusChangeListener",
                        object : XC_MethodHook() {
                            override fun beforeHookedMethod(param: MethodHookParam) {
                                param.args.forEach(hookListenerClass)
                            }
                        }
                    )
                }
            }
        }
    }

    private fun hookSettingsLockToApp(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        runCatching {
            XposedHelpers.findAndHookMethod(
                Settings.System::class.java,
                "getInt",
                ContentResolver::class.java,
                String::class.java,
                Int::class.javaPrimitiveType,
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (param.args[1] == "lock_to_app_enabled") {
                            param.result = 1
                            log(pkg, "Settings.System[lock_to_app_enabled] -> 1")
                        }
                    }
                }
            )
            XposedHelpers.findAndHookMethod(
                Settings.System::class.java,
                "getInt",
                ContentResolver::class.java,
                String::class.java,
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (param.args[1] == "lock_to_app_enabled") {
                            param.result = 1
                        }
                    }
                }
            )
        }.onFailure {
            log(pkg, "Settings.System hook skipped: \${it.message}")
        }
    }

    private fun hookDevicePolicyPermitted(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        runCatching {
            XposedHelpers.findAndHookMethod(
                DevicePolicyManager::class.java,
                "isLockTaskPermitted",
                String::class.java,
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (param.args[0] == pkg) {
                            param.result = true
                            log(pkg, "DevicePolicyManager.isLockTaskPermitted($pkg) -> true")
                        }
                    }
                }
            )
        }.onFailure {
            log(pkg, "DevicePolicyManager hook skipped: \${it.message}")
        }
    }

    companion object {
        private const val WEBVIEW_STEALTH_JS = """
            (function() {
              if (window.__pinspoofStealthApplied) return;
              window.__pinspoofStealthApplied = true;
              try {
                Object.defineProperty(document, 'hidden', { get: function() { return false; }, configurable: true });
                Object.defineProperty(document, 'webkitHidden', { get: function() { return false; }, configurable: true });
                Object.defineProperty(document, 'visibilityState', { get: function() { return 'visible'; }, configurable: true });
                Object.defineProperty(document, 'webkitVisibilityState', { get: function() { return 'visible'; }, configurable: true });
              } catch (e) {}
              try {
                document.hasFocus = function() { return true; };
              } catch (e) {}
              try {
                var stopFocusEvent = function(e) {
                  if (e.type === 'blur' && e.target !== window && e.target !== document) return;
                  e.stopImmediatePropagation();
                };
                window.addEventListener('blur', stopFocusEvent, true);
                document.addEventListener('visibilitychange', stopFocusEvent, true);
                document.addEventListener('webkitvisibilitychange', stopFocusEvent, true);
              } catch (e) {}
            })();
        """
    }
}
`;
}

function generatePinSpoofThemeKt(pkg: string): string {
  return `package ${pkg}.ui

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val FallbackDarkScheme = darkColorScheme(
    primary = Color(0xFF7AD6A8),
    onPrimary = Color(0xFF003823),
    primaryContainer = Color(0xFF005235),
    onPrimaryContainer = Color(0xFF96F3C3),
    secondary = Color(0xFFB4CCB9),
    onSecondary = Color(0xFF203527),
    secondaryContainer = Color(0xFF364B3D),
    onSecondaryContainer = Color(0xFFD0E8D5),
    surface = Color(0xFF0F1512),
    surfaceContainer = Color(0xFF1B211E),
    surfaceContainerHigh = Color(0xFF262C28),
)

private val FallbackLightScheme = lightColorScheme(
    primary = Color(0xFF006C48),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFF96F3C3),
    onPrimaryContainer = Color(0xFF002114),
    secondary = Color(0xFF4D6354),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFD0E8D5),
    onSecondaryContainer = Color(0xFF0B1F14),
)

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun PinSpoofTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit
) {
    val context = LocalContext.current
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> FallbackDarkScheme
        else -> FallbackLightScheme
    }

    MaterialExpressiveTheme(
        colorScheme = colorScheme,
        motionScheme = MotionScheme.expressive(),
        content = content
    )
}
`;
}

function generatePrefsManagerKt(pkg: string): string {
  return `package ${pkg}.prefs

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject
import ${pkg}.HookConfig

enum class HookPreset(val label: String, val summary: String) {
    LIGHT("Light", "Pinning bypass & state spoof only"),
    BALANCED("Balanced", "Safe defaults: pinning + focus + multi-window"),
    AGGRESSIVE("Aggressive", "All stealth, WebView JS, lifecycle & UI hooks")
}

data class GranularHookState(
    val masterEnabled: Boolean = true,
    val alwaysSpoofPinned: Boolean = HookConfig.ALWAYS_SPOOF_PINNED,
    val hideFocusLoss: Boolean = HookConfig.HIDE_FOCUS_LOSS,
    val hideWebViewVisibility: Boolean = HookConfig.HIDE_WEBVIEW_VISIBILITY,
    val hideLifecycleLoss: Boolean = HookConfig.HIDE_LIFECYCLE_LOSS,
    val hideMultiWindowPip: Boolean = HookConfig.HIDE_MULTI_WINDOW_PIP,
    val spoofPinnedInsets: Boolean = HookConfig.SPOOF_PINNED_INSETS,
    val stripFlagSecure: Boolean = HookConfig.STRIP_FLAG_SECURE,
    val hideAccessibilityOverlays: Boolean = HookConfig.HIDE_ACCESSIBILITY_OVERLAYS,
    val retainAudioFocus: Boolean = HookConfig.RETAIN_AUDIO_FOCUS,
    val hookActivityLockTask: Boolean = HookConfig.HOOK_ACTIVITY_LOCK_TASK,
    val hookActivityManagerState: Boolean = HookConfig.HOOK_ACTIVITY_MANAGER_STATE,
    val hookBinderProxies: Boolean = HookConfig.HOOK_BINDER_PROXIES,
    val hookActivityClient: Boolean = HookConfig.HOOK_ACTIVITY_CLIENT,
    val hookSettingsLockToApp: Boolean = HookConfig.HOOK_SETTINGS_LOCK_TO_APP,
    val hookDpmPermitted: Boolean = HookConfig.HOOK_DPM_LOCK_TASK_PERMITTED,
    val debugLogging: Boolean = HookConfig.DEBUG_LOGGING
) {
    fun withPreset(preset: HookPreset): GranularHookState = when (preset) {
        HookPreset.LIGHT -> copy(
            masterEnabled = true,
            alwaysSpoofPinned = false,
            hideFocusLoss = false,
            hideWebViewVisibility = false,
            hideLifecycleLoss = false,
            hideMultiWindowPip = false,
            spoofPinnedInsets = false,
            stripFlagSecure = false,
            hideAccessibilityOverlays = false,
            retainAudioFocus = false,
            hookActivityLockTask = true,
            hookActivityManagerState = true,
            hookBinderProxies = false,
            hookActivityClient = true,
            hookSettingsLockToApp = false,
            hookDpmPermitted = false
        )
        HookPreset.BALANCED -> copy(
            masterEnabled = true,
            alwaysSpoofPinned = false,
            hideFocusLoss = true,
            hideWebViewVisibility = false,
            hideLifecycleLoss = false,
            hideMultiWindowPip = true,
            spoofPinnedInsets = false,
            stripFlagSecure = false,
            hideAccessibilityOverlays = false,
            retainAudioFocus = false,
            hookActivityLockTask = true,
            hookActivityManagerState = true,
            hookBinderProxies = false,
            hookActivityClient = true,
            hookSettingsLockToApp = false,
            hookDpmPermitted = false
        )
        HookPreset.AGGRESSIVE -> copy(
            masterEnabled = true,
            alwaysSpoofPinned = false,
            hideFocusLoss = true,
            hideWebViewVisibility = true,
            hideLifecycleLoss = true,
            hideMultiWindowPip = true,
            spoofPinnedInsets = true,
            stripFlagSecure = true,
            hideAccessibilityOverlays = true,
            retainAudioFocus = true,
            hookActivityLockTask = true,
            hookActivityManagerState = true,
            hookBinderProxies = true,
            hookActivityClient = true,
            hookSettingsLockToApp = true,
            hookDpmPermitted = true
        )
    }

    fun toJson(targetPackage: String?): String = JSONObject().apply {
        put("schemaVersion", 2)
        put("targetPackage", targetPackage ?: "global")
        put("masterEnabled", masterEnabled)
        put("alwaysSpoofPinned", alwaysSpoofPinned)
        put("hideFocusLoss", hideFocusLoss)
        put("hideWebViewVisibility", hideWebViewVisibility)
        put("hideLifecycleLoss", hideLifecycleLoss)
        put("hideMultiWindowPip", hideMultiWindowPip)
        put("spoofPinnedInsets", spoofPinnedInsets)
        put("stripFlagSecure", stripFlagSecure)
        put("hideAccessibilityOverlays", hideAccessibilityOverlays)
        put("retainAudioFocus", retainAudioFocus)
        put("hookActivityLockTask", hookActivityLockTask)
        put("hookActivityManagerState", hookActivityManagerState)
        put("hookBinderProxies", hookBinderProxies)
        put("hookActivityClient", hookActivityClient)
        put("hookSettingsLockToApp", hookSettingsLockToApp)
        put("hookDpmPermitted", hookDpmPermitted)
        put("debugLogging", debugLogging)
    }.toString(2)

    companion object {
        fun fromJson(raw: String, base: GranularHookState = GranularHookState()): GranularHookState {
            val obj = JSONObject(raw)
            return base.copy(
                masterEnabled = obj.optBoolean("masterEnabled", base.masterEnabled),
                alwaysSpoofPinned = obj.optBoolean("alwaysSpoofPinned", base.alwaysSpoofPinned),
                hideFocusLoss = obj.optBoolean("hideFocusLoss", base.hideFocusLoss),
                hideWebViewVisibility = obj.optBoolean("hideWebViewVisibility", base.hideWebViewVisibility),
                hideLifecycleLoss = obj.optBoolean("hideLifecycleLoss", base.hideLifecycleLoss),
                hideMultiWindowPip = obj.optBoolean("hideMultiWindowPip", base.hideMultiWindowPip),
                spoofPinnedInsets = obj.optBoolean("spoofPinnedInsets", base.spoofPinnedInsets),
                stripFlagSecure = obj.optBoolean("stripFlagSecure", base.stripFlagSecure),
                hideAccessibilityOverlays = obj.optBoolean("hideAccessibilityOverlays", base.hideAccessibilityOverlays),
                retainAudioFocus = obj.optBoolean("retainAudioFocus", base.retainAudioFocus),
                hookActivityLockTask = obj.optBoolean("hookActivityLockTask", base.hookActivityLockTask),
                hookActivityManagerState = obj.optBoolean("hookActivityManagerState", base.hookActivityManagerState),
                hookBinderProxies = obj.optBoolean("hookBinderProxies", base.hookBinderProxies),
                hookActivityClient = obj.optBoolean("hookActivityClient", base.hookActivityClient),
                hookSettingsLockToApp = obj.optBoolean("hookSettingsLockToApp", base.hookSettingsLockToApp),
                hookDpmPermitted = obj.optBoolean("hookDpmPermitted", base.hookDpmPermitted),
                debugLogging = obj.optBoolean("debugLogging", base.debugLogging)
            )
        }
    }
}

data class HookStats(
    val pinBlocked: Long = 0L,
    val focusHidden: Long = 0L,
    val lifecycleHidden: Long = 0L,
    val webviewSpoofed: Long = 0L,
    val lastUpdatedMs: Long = 0L
) {
    val total: Long get() = pinBlocked + focusHidden + lifecycleHidden + webviewSpoofed
}

class PrefsManager(context: Context) {

    val isWorldReadableActive: Boolean
    private val prefs: SharedPreferences
    private val statsPrefs: SharedPreferences

    init {
        val (sp, worldOk) = openPrefs(context)
        isWorldReadableActive = worldOk
        prefs = sp
        statsPrefs = context.getSharedPreferences(HookConfig.STATS_PREFS_NAME, Context.MODE_PRIVATE)
    }

    @Suppress("DEPRECATION")
    @SuppressLint("WorldReadableFiles")
    private fun openPrefs(context: Context): Pair<SharedPreferences, Boolean> {
        return try {
            val worldPrefs = context.getSharedPreferences(
                HookConfig.PREFS_NAME,
                Context.MODE_WORLD_READABLE
            )
            worldPrefs to true
        } catch (_: SecurityException) {
            context.getSharedPreferences(HookConfig.PREFS_NAME, Context.MODE_PRIVATE) to false
        }
    }

    fun hasPerAppOverride(packageName: String): Boolean =
        prefs.getBoolean("\${packageName}::override", false)

    fun setPerAppOverride(packageName: String, enabled: Boolean) {
        prefs.edit().putBoolean("\${packageName}::override", enabled).apply()
    }

    fun loadState(targetPackage: String?): GranularHookState {
        val prefix = if (targetPackage != null && hasPerAppOverride(targetPackage)) {
            "$targetPackage::"
        } else {
            "global::"
        }
        val g = if (prefix != "global::") loadState(null) else null
        return GranularHookState(
            masterEnabled = prefs.getBoolean("\${prefix}master_enabled", g?.masterEnabled ?: true),
            alwaysSpoofPinned = prefs.getBoolean(
                "\${prefix}always_spoof_pinned",
                g?.alwaysSpoofPinned ?: HookConfig.ALWAYS_SPOOF_PINNED
            ),
            hideFocusLoss = prefs.getBoolean(
                "\${prefix}hide_focus_loss",
                g?.hideFocusLoss ?: HookConfig.HIDE_FOCUS_LOSS
            ),
            hideWebViewVisibility = prefs.getBoolean(
                "\${prefix}hide_webview_visibility",
                g?.hideWebViewVisibility ?: HookConfig.HIDE_WEBVIEW_VISIBILITY
            ),
            hideLifecycleLoss = prefs.getBoolean(
                "\${prefix}hide_lifecycle_loss",
                g?.hideLifecycleLoss ?: HookConfig.HIDE_LIFECYCLE_LOSS
            ),
            hideMultiWindowPip = prefs.getBoolean(
                "\${prefix}hide_multi_window_pip",
                g?.hideMultiWindowPip ?: HookConfig.HIDE_MULTI_WINDOW_PIP
            ),
            spoofPinnedInsets = prefs.getBoolean(
                "\${prefix}spoof_pinned_insets",
                g?.spoofPinnedInsets ?: HookConfig.SPOOF_PINNED_INSETS
            ),
            stripFlagSecure = prefs.getBoolean(
                "\${prefix}strip_flag_secure",
                g?.stripFlagSecure ?: HookConfig.STRIP_FLAG_SECURE
            ),
            hideAccessibilityOverlays = prefs.getBoolean(
                "\${prefix}hide_accessibility_overlays",
                g?.hideAccessibilityOverlays ?: HookConfig.HIDE_ACCESSIBILITY_OVERLAYS
            ),
            retainAudioFocus = prefs.getBoolean(
                "\${prefix}retain_audio_focus",
                g?.retainAudioFocus ?: HookConfig.RETAIN_AUDIO_FOCUS
            ),
            hookActivityLockTask = prefs.getBoolean(
                "\${prefix}hook_activity_lock_task",
                g?.hookActivityLockTask ?: HookConfig.HOOK_ACTIVITY_LOCK_TASK
            ),
            hookActivityManagerState = prefs.getBoolean(
                "\${prefix}hook_activity_manager_state",
                g?.hookActivityManagerState ?: HookConfig.HOOK_ACTIVITY_MANAGER_STATE
            ),
            hookBinderProxies = prefs.getBoolean(
                "\${prefix}hook_binder_proxies",
                g?.hookBinderProxies ?: HookConfig.HOOK_BINDER_PROXIES
            ),
            hookActivityClient = prefs.getBoolean(
                "\${prefix}hook_activity_client",
                g?.hookActivityClient ?: HookConfig.HOOK_ACTIVITY_CLIENT
            ),
            hookSettingsLockToApp = prefs.getBoolean(
                "\${prefix}hook_settings_lock_to_app",
                g?.hookSettingsLockToApp ?: HookConfig.HOOK_SETTINGS_LOCK_TO_APP
            ),
            hookDpmPermitted = prefs.getBoolean(
                "\${prefix}hook_dpm_permitted",
                g?.hookDpmPermitted ?: HookConfig.HOOK_DPM_LOCK_TASK_PERMITTED
            ),
            debugLogging = prefs.getBoolean(
                "\${prefix}debug_logging",
                g?.debugLogging ?: HookConfig.DEBUG_LOGGING
            )
        )
    }

    fun saveState(targetPackage: String?, state: GranularHookState) {
        val prefix = if (targetPackage != null) "$targetPackage::" else "global::"
        prefs.edit().apply {
            if (targetPackage != null) {
                putBoolean("\${targetPackage}::override", true)
            }
            putBoolean("\${prefix}master_enabled", state.masterEnabled)
            putBoolean("\${prefix}always_spoof_pinned", state.alwaysSpoofPinned)
            putBoolean("\${prefix}hide_focus_loss", state.hideFocusLoss)
            putBoolean("\${prefix}hide_webview_visibility", state.hideWebViewVisibility)
            putBoolean("\${prefix}hide_lifecycle_loss", state.hideLifecycleLoss)
            putBoolean("\${prefix}hide_multi_window_pip", state.hideMultiWindowPip)
            putBoolean("\${prefix}spoof_pinned_insets", state.spoofPinnedInsets)
            putBoolean("\${prefix}strip_flag_secure", state.stripFlagSecure)
            putBoolean("\${prefix}hide_accessibility_overlays", state.hideAccessibilityOverlays)
            putBoolean("\${prefix}retain_audio_focus", state.retainAudioFocus)
            putBoolean("\${prefix}hook_activity_lock_task", state.hookActivityLockTask)
            putBoolean("\${prefix}hook_activity_manager_state", state.hookActivityManagerState)
            putBoolean("\${prefix}hook_binder_proxies", state.hookBinderProxies)
            putBoolean("\${prefix}hook_activity_client", state.hookActivityClient)
            putBoolean("\${prefix}hook_settings_lock_to_app", state.hookSettingsLockToApp)
            putBoolean("\${prefix}hook_dpm_permitted", state.hookDpmPermitted)
            putBoolean("\${prefix}debug_logging", state.debugLogging)
        }.apply()
    }

    fun loadStats(targetPackage: String?): HookStats {
        val key = targetPackage ?: "__all__"
        return HookStats(
            pinBlocked = statsPrefs.getLong("$key::pin", 0L),
            focusHidden = statsPrefs.getLong("$key::focus", 0L),
            lifecycleHidden = statsPrefs.getLong("$key::lifecycle", 0L),
            webviewSpoofed = statsPrefs.getLong("$key::webview", 0L),
            lastUpdatedMs = statsPrefs.getLong("$key::ts", 0L)
        )
    }

    fun resetStats(targetPackage: String?) {
        statsPrefs.edit().apply {
            if (targetPackage == null) {
                clear()
            } else {
                remove("$targetPackage::pin")
                remove("$targetPackage::focus")
                remove("$targetPackage::lifecycle")
                remove("$targetPackage::webview")
                remove("$targetPackage::ts")
            }
        }.apply()
    }

    fun registerStatsListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) {
        statsPrefs.registerOnSharedPreferenceChangeListener(listener)
    }

    fun unregisterStatsListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) {
        statsPrefs.unregisterOnSharedPreferenceChangeListener(listener)
    }
}
`;
}

function generateMainActivityKt(config: ModuleConfig, pkg: string): string {
  return `package ${pkg}

import android.content.SharedPreferences
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas as AndroidCanvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AccessibilityNew
import androidx.compose.material.icons.rounded.Analytics
import androidx.compose.material.icons.rounded.Android
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.AspectRatio
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Language
import androidx.compose.material.icons.rounded.LayersClear
import androidx.compose.material.icons.rounded.PauseCircleOutline
import androidx.compose.material.icons.rounded.PhonelinkLock
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material.icons.rounded.Upload
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material.icons.rounded.VolumeUp
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import ${pkg}.prefs.GranularHookState
import ${pkg}.prefs.HookPreset
import ${pkg}.prefs.HookStats
import ${pkg}.prefs.PrefsManager
import ${pkg}.ui.PinSpoofTheme

data class InstalledAppItem(
    val label: String,
    val packageName: String,
    val hasOverride: Boolean
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val prefsManager = PrefsManager(this)
        setContent {
            PinSpoofTheme {
                PinSpoofControlScreen(prefsManager = prefsManager)
            }
        }
    }
}

private fun Drawable.toComposeImageBitmap(sizePx: Int = 128): ImageBitmap {
    if (this is BitmapDrawable && bitmap != null) {
        return bitmap.asImageBitmap()
    }
    val width = if (intrinsicWidth > 0) intrinsicWidth.coerceIn(48, sizePx) else sizePx
    val height = if (intrinsicHeight > 0) intrinsicHeight.coerceIn(48, sizePx) else sizePx
    val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = AndroidCanvas(bmp)
    setBounds(0, 0, canvas.width, canvas.height)
    draw(canvas)
    return bmp.asImageBitmap()
}

@Composable
private fun AppIconView(
    packageName: String,
    contentDescription: String?,
    size: Dp = 44.dp
) {
    val context = LocalContext.current
    val iconBitmap by produceState<ImageBitmap?>(initialValue = null, key1 = packageName) {
        value = withContext(Dispatchers.IO) {
            runCatching {
                context.packageManager.getApplicationIcon(packageName).toComposeImageBitmap()
            }.getOrNull()
        }
    }

    val shape = RoundedCornerShape(14.dp)
    val bmp = iconBitmap
    if (bmp != null) {
        Image(
            bitmap = bmp,
            contentDescription = contentDescription,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .size(size)
                .clip(shape)
        )
    } else {
        Box(
            modifier = Modifier
                .size(size)
                .clip(shape)
                .background(MaterialTheme.colorScheme.surfaceContainerHighest),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Rounded.Android,
                contentDescription = contentDescription,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(size * 0.55f)
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun PinSpoofControlScreen(prefsManager: PrefsManager) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()

    var selectedPkg by remember { mutableStateOf<String?>(null) }
    var selectedLabel by remember { mutableStateOf("Global Defaults") }
    var hookState by remember(selectedPkg) { mutableStateOf(prefsManager.loadState(selectedPkg)) }
    var hasOverride by remember(selectedPkg) {
        mutableStateOf(selectedPkg?.let { prefsManager.hasPerAppOverride(it) } ?: false)
    }
    var stats by remember(selectedPkg) { mutableStateOf(prefsManager.loadStats(selectedPkg)) }
    var showAppPicker by remember { mutableStateOf(false) }

    DisposableEffect(prefsManager, selectedPkg) {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ ->
            stats = prefsManager.loadStats(selectedPkg)
        }
        prefsManager.registerStatsListener(listener)
        onDispose { prefsManager.unregisterStatsListener(listener) }
    }

    fun updateState(transform: (GranularHookState) -> GranularHookState) {
        val next = transform(hookState)
        hookState = next
        prefsManager.saveState(selectedPkg, next)
        if (selectedPkg != null) {
            hasOverride = true
        }
    }

    val exportLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.openOutputStream(uri)?.use { stream ->
                stream.write(hookState.toJson(selectedPkg).toByteArray(Charsets.UTF_8))
            }
        }.onSuccess {
            scope.launch { snackbarHostState.showSnackbar("Exported profile JSON") }
        }.onFailure {
            scope.launch { snackbarHostState.showSnackbar("Export failed: \${it.message}") }
        }
    }

    val importLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching {
            val raw = context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
                ?: error("Empty file")
            GranularHookState.fromJson(raw, hookState)
        }.onSuccess { imported ->
            updateState { imported }
            scope.launch { snackbarHostState.showSnackbar("Imported profile JSON") }
        }.onFailure {
            scope.launch { snackbarHostState.showSnackbar("Invalid JSON profile") }
        }
    }

    Scaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            LargeTopAppBar(
                title = {
                    Column {
                        Text(
                            text = "\${HookConfig.MODULE_TAG} v${config.versionName}",
                            style = MaterialTheme.typography.headlineMediumEmphasized,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = if (prefsManager.isWorldReadableActive) {
                                "LSPosed xposedsharedprefs active · App-scoped"
                            } else {
                                "Enable module in LSPosed to sync preferences"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                scrollBehavior = scrollBehavior
            )
        }
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                start = 16.dp,
                end = 16.dp,
                top = innerPadding.calculateTopPadding() + 8.dp,
                bottom = innerPadding.calculateBottomPadding() + 28.dp
            ),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Expressive Scope Selector Card + JSON Export/Import
            item {
                ElevatedCard(
                    shape = RoundedCornerShape(28.dp),
                    colors = CardDefaults.elevatedCardColors(
                        containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f)
                    )
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(14.dp)
                        ) {
                            val activePkg = selectedPkg
                            if (activePkg != null) {
                                AppIconView(
                                    packageName = activePkg,
                                    contentDescription = selectedLabel,
                                    size = 44.dp
                                )
                            } else {
                                Box(
                                    modifier = Modifier
                                        .size(44.dp)
                                        .clip(RoundedCornerShape(14.dp))
                                        .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.16f)),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(
                                        imageVector = Icons.Rounded.Apps,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.primary
                                    )
                                }
                            }
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = selectedLabel,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Spacer(Modifier.height(2.dp))
                                Text(
                                    text = selectedPkg ?: "Applies to all apps in LSPosed scope",
                                    style = MaterialTheme.typography.bodySmall,
                                    fontFamily = if (selectedPkg != null) FontFamily.Monospace else FontFamily.Default,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            FilledTonalButton(
                                onClick = { showAppPicker = true },
                                shape = RoundedCornerShape(16.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.Tune,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp)
                                )
                                Spacer(Modifier.size(8.dp))
                                Text("Select App Override")
                            }

                            if (selectedPkg != null) {
                                TextButton(
                                    onClick = {
                                        selectedPkg?.let { prefsManager.setPerAppOverride(it, false) }
                                        selectedPkg = null
                                        selectedLabel = "Global Defaults"
                                    }
                                ) {
                                    Text("Use Global")
                                }
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            OutlinedButton(
                                onClick = {
                                    val base = selectedPkg ?: "global"
                                    exportLauncher.launch("pinspoof-$base.json")
                                },
                                shape = RoundedCornerShape(14.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Icon(Icons.Rounded.Upload, null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.size(6.dp))
                                Text("Export JSON")
                            }
                            OutlinedButton(
                                onClick = { importLauncher.launch(arrayOf("application/json", "text/plain")) },
                                shape = RoundedCornerShape(14.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Icon(Icons.Rounded.Download, null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.size(6.dp))
                                Text("Import JSON")
                            }
                        }

                        if (selectedPkg != null) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    text = "Custom override active for this app",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                ExpressiveSwitch(
                                    checked = hasOverride,
                                    onCheckedChange = { enabled ->
                                        selectedPkg?.let {
                                            prefsManager.setPerAppOverride(it, enabled)
                                            hasOverride = enabled
                                            hookState = prefsManager.loadState(if (enabled) it else null)
                                        }
                                    }
                                )
                            }
                        }
                    }
                }
            }

            // Live Hook Event Counter Card
            item {
                ElevatedCard(shape = RoundedCornerShape(28.dp)) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.Analytics,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary
                                )
                                Column {
                                    Text(
                                        text = "Live Hook Event Counter",
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                    Text(
                                        text = if (selectedPkg == null) "All scoped apps combined" else selectedLabel,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                            Row {
                                IconButton(onClick = { stats = prefsManager.loadStats(selectedPkg) }) {
                                    Icon(Icons.Rounded.Refresh, contentDescription = "Refresh counts")
                                }
                                TextButton(onClick = {
                                    prefsManager.resetStats(selectedPkg)
                                    stats = HookStats()
                                }) {
                                    Text("Reset")
                                }
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            StatTile("Pinning", stats.pinBlocked, Modifier.weight(1f))
                            StatTile("Focus", stats.focusHidden, Modifier.weight(1f))
                            StatTile("WebView", stats.webviewSpoofed, Modifier.weight(1f))
                            StatTile("Lifecycle", stats.lifecycleHidden, Modifier.weight(1f))
                        }
                    }
                }
            }

            // One-Tap Preset Profiles + Master LockTask Spoof & Timing Card
            item {
                ElevatedCard(shape = RoundedCornerShape(28.dp)) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                text = "One-Tap Preset Profiles",
                                style = MaterialTheme.typography.labelLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                                HookPreset.entries.forEachIndexed { index, preset ->
                                    val isSelected = hookState == hookState.withPreset(preset)
                                    SegmentedButton(
                                        selected = isSelected,
                                        onClick = {
                                            updateState { it.withPreset(preset) }
                                            scope.launch {
                                                snackbarHostState.showSnackbar("Applied \${preset.label} preset")
                                            }
                                        },
                                        shape = SegmentedButtonDefaults.itemShape(
                                            index = index,
                                            count = HookPreset.entries.size
                                        )
                                    ) {
                                        Text(preset.label)
                                    }
                                }
                            }
                        }

                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))

                        ExpressiveToggleRow(
                            icon = Icons.Rounded.PhonelinkLock,
                            title = "Disable Pinning & Spoof Pinned",
                            subtitle = "Swallow startLockTask() and report LOCK_TASK_MODE_PINNED (2) without system_server scope",
                            checked = hookState.masterEnabled,
                            onCheckedChange = { v -> updateState { it.copy(masterEnabled = v) } }
                        )

                        AnimatedVisibility(visible = hookState.masterEnabled) {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(
                                    text = "Spoof Timing Mode (Reactive recommended)",
                                    style = MaterialTheme.typography.labelLarge,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                                    SegmentedButton(
                                        selected = !hookState.alwaysSpoofPinned,
                                        onClick = { updateState { it.copy(alwaysSpoofPinned = false) } },
                                        shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2)
                                    ) {
                                        Text("Reactive")
                                    }
                                    SegmentedButton(
                                        selected = hookState.alwaysSpoofPinned,
                                        onClick = { updateState { it.copy(alwaysSpoofPinned = true) } },
                                        shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2)
                                    ) {
                                        Text("Always Pinned")
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Focus, WebView & Lifecycle Stealth Card
            item {
                ElevatedCard(shape = RoundedCornerShape(28.dp)) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.VisibilityOff,
                            title = "Window Focus Spoofing (Safe)",
                            subtitle = "Drop onWindowFocusChanged(false), topResumed(false), onUserLeaveHint(), hasWindowFocus() -> true, IMPORTANCE_FOREGROUND",
                            checked = hookState.hideFocusLoss,
                            onCheckedChange = { v -> updateState { it.copy(hideFocusLoss = v) } }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.Language,
                            title = "WebView Visibility, JS & Pause Stealth",
                            subtitle = "Force View.VISIBLE, block WebView.onPause()/pauseTimers(), and spoof JS document.hidden / visibilityState / blur",
                            checked = hookState.hideWebViewVisibility,
                            onCheckedChange = { v -> updateState { it.copy(hideWebViewVisibility = v) } }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.PauseCircleOutline,
                            title = "Suppress onPause / onStop (Advanced)",
                            subtitle = "OFF by default: blocking Activity/LifecycleRegistry transitions can stall SurfaceView/TextureView graphics on resume",
                            checked = hookState.hideLifecycleLoss,
                            onCheckedChange = { v -> updateState { it.copy(hideLifecycleLoss = v) } }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.LayersClear,
                            title = "Hide Multi-Window & PiP",
                            subtitle = "Return false for isInMultiWindowMode() and isInPictureInPictureMode()",
                            checked = hookState.hideMultiWindowPip,
                            onCheckedChange = { v -> updateState { it.copy(hideMultiWindowPip = v) } }
                        )
                    }
                }
            }

            // Modern UI, Window Insets & Environment Stealth Card
            item {
                ElevatedCard(shape = RoundedCornerShape(28.dp)) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Text(
                            text = "Window, Insets & Environment Stealth",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold
                        )

                        ExpressiveToggleRow(
                            icon = Icons.Rounded.AspectRatio,
                            title = "Simulate Pinned Window Insets",
                            subtitle = "Report zeroed system bar WindowInsets while keeping your actual navigation bar & gestures usable",
                            checked = hookState.spoofPinnedInsets,
                            onCheckedChange = { v -> updateState { it.copy(spoofPinnedInsets = v) } }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.Shield,
                            title = "Strip FLAG_SECURE",
                            subtitle = "Clear FLAG_SECURE on Windows and SurfaceViews for screenshots and screen troubleshooting",
                            checked = hookState.stripFlagSecure,
                            onCheckedChange = { v -> updateState { it.copy(stripFlagSecure = v) } }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.AccessibilityNew,
                            title = "Hide Accessibility & Overlay Checks",
                            subtitle = "Return empty AccessibilityManager service list and Settings.canDrawOverlays() = false",
                            checked = hookState.hideAccessibilityOverlays,
                            onCheckedChange = { v -> updateState { it.copy(hideAccessibilityOverlays = v) } }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.VolumeUp,
                            title = "Retain Audio Focus",
                            subtitle = "Suppress negative OnAudioFocusChangeListener events when notifications play",
                            checked = hookState.retainAudioFocus,
                            onCheckedChange = { v -> updateState { it.copy(retainAudioFocus = v) } }
                        )
                    }
                }
            }

            // Granular Hook Surface Matrix
            item {
                ElevatedCard(shape = RoundedCornerShape(28.dp)) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Text(
                            text = "LockTask Hook Surfaces",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold
                        )

                        GranularSwitchItem(
                            title = "Activity.startLockTask / stopLockTask",
                            subtitle = "Intercept public Activity lock-task transitions",
                            checked = hookState.hookActivityLockTask,
                            onCheckedChange = { v -> updateState { it.copy(hookActivityLockTask = v) } }
                        )
                        GranularSwitchItem(
                            title = "ActivityManager State Queries",
                            subtitle = "Spoof getLockTaskModeState() & isInLockTaskMode()",
                            checked = hookState.hookActivityManagerState,
                            onCheckedChange = { v -> updateState { it.copy(hookActivityManagerState = v) } }
                        )
                        GranularSwitchItem(
                            title = "ActivityClient Wrapper (Android 12–16)",
                            subtitle = "Dynamic LockTask token scan safe across OEM ROMs",
                            checked = hookState.hookActivityClient,
                            onCheckedChange = { v -> updateState { it.copy(hookActivityClient = v) } }
                        )
                        GranularSwitchItem(
                            title = "Binder Stub\\$Proxy Interception (Advanced)",
                            subtitle = "OFF by default: dynamic Stub\\$Proxy scan for apps calling Binder proxies directly",
                            checked = hookState.hookBinderProxies,
                            onCheckedChange = { v -> updateState { it.copy(hookBinderProxies = v) } }
                        )
                        GranularSwitchItem(
                            title = "Settings.System lock_to_app_enabled",
                            subtitle = "Spoof system screen-pinning toggle as enabled (1)",
                            checked = hookState.hookSettingsLockToApp,
                            onCheckedChange = { v -> updateState { it.copy(hookSettingsLockToApp = v) } }
                        )
                        GranularSwitchItem(
                            title = "DevicePolicyManager.isLockTaskPermitted",
                            subtitle = "Report LockTask permission as granted for scoped package",
                            checked = hookState.hookDpmPermitted,
                            onCheckedChange = { v -> updateState { it.copy(hookDpmPermitted = v) } }
                        )
                        GranularSwitchItem(
                            title = "Verbose LSPosed Logging",
                            subtitle = "Emit XposedBridge.log traces for intercepted calls",
                            checked = hookState.debugLogging,
                            onCheckedChange = { v -> updateState { it.copy(debugLogging = v) } }
                        )
                    }
                }
            }
        }
    }

    if (showAppPicker) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        var query by remember { mutableStateOf("") }
        val installedApps = remember {
            val pm = context.packageManager
            pm.getInstalledApplications(PackageManager.GET_META_DATA)
                .asSequence()
                .filter {
                    it.packageName != HookConfig.MODULE_PKG &&
                        it.packageName != "android" &&
                        (it.flags and ApplicationInfo.FLAG_SYSTEM) == 0
                }
                .map {
                    InstalledAppItem(
                        label = pm.getApplicationLabel(it).toString(),
                        packageName = it.packageName,
                        hasOverride = prefsManager.hasPerAppOverride(it.packageName)
                    )
                }
                .sortedWith(compareByDescending<InstalledAppItem> { it.hasOverride }.thenBy { it.label })
                .toList()
        }

        val filtered = remember(query, installedApps) {
            if (query.isBlank()) installedApps
            else installedApps.filter {
                it.label.contains(query, ignoreCase = true) ||
                    it.packageName.contains(query, ignoreCase = true)
            }
        }

        ModalBottomSheet(
            onDismissRequest = { showAppPicker = false },
            sheetState = sheetState
        ) {
            Column(
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = "Select App for Granular Override",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold
                    )
                    OutlinedTextField(
                        value = query,
                        onValueChange = { query = it },
                        placeholder = { Text("Filter by app name or package ID") },
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Rounded.Search,
                                contentDescription = null
                            )
                        },
                        singleLine = true,
                        shape = RoundedCornerShape(18.dp),
                        modifier = Modifier.fillMaxWidth()
                    )
                }

                Spacer(Modifier.height(14.dp))

                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(420.dp),
                    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    items(filtered, key = { it.packageName }) { app ->
                        Surface(
                            onClick = {
                                selectedPkg = app.packageName
                                selectedLabel = app.label
                                showAppPicker = false
                            },
                            shape = RoundedCornerShape(20.dp),
                            color = if (app.hasOverride) {
                                MaterialTheme.colorScheme.secondaryContainer
                            } else {
                                MaterialTheme.colorScheme.surfaceContainerHigh
                            }
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 14.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(14.dp)
                            ) {
                                AppIconView(
                                    packageName = app.packageName,
                                    contentDescription = app.label,
                                    size = 44.dp
                                )

                                Column(
                                    modifier = Modifier.weight(1f),
                                    verticalArrangement = Arrangement.spacedBy(2.dp)
                                ) {
                                    Text(
                                        text = app.label,
                                        style = MaterialTheme.typography.bodyLarge,
                                        fontWeight = FontWeight.Medium,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    Text(
                                        text = app.packageName,
                                        style = MaterialTheme.typography.bodySmall,
                                        fontFamily = FontFamily.Monospace,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }

                                if (app.hasOverride) {
                                    Surface(
                                        shape = RoundedCornerShape(10.dp),
                                        color = MaterialTheme.colorScheme.primary.copy(alpha = 0.14f)
                                    ) {
                                        Text(
                                            text = "Custom",
                                            style = MaterialTheme.typography.labelSmall,
                                            fontWeight = FontWeight.SemiBold,
                                            color = MaterialTheme.colorScheme.primary,
                                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
                Spacer(Modifier.height(20.dp))
            }
        }
    }
}

@Composable
private fun StatTile(
    label: String,
    count: Long,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                text = count.toString(),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
                color = MaterialTheme.colorScheme.primary
            )
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun ExpressiveToggleRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = if (checked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
        )
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        ExpressiveSwitch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun GranularSwitchItem(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        ExpressiveSwitch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun ExpressiveSwitch(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Switch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        thumbContent = {
            Icon(
                imageVector = if (checked) Icons.Rounded.Check else Icons.Rounded.Close,
                contentDescription = null,
                modifier = Modifier.size(SwitchDefaults.IconSize)
            )
        }
    )
}
`;
}

function generateAndroidManifest(config: ModuleConfig, pkg: string, scopes: string[]): string {
  const scopeMeta =
    scopes.length > 0
      ? `        <meta-data
            android:name="xposedscope"
            android:resource="@array/xposed_scope" />`
      : `        <!-- xposedscope intentionally omitted so LSPosed lets you pick any target app freely without system_server -->`;

  const permissions = config.includeMaterialYouUi
    ? `    <!-- Needed so the in-app Material You override picker can list installed user apps on Android 11-16 -->
    <uses-permission android:name="android.permission.QUERY_ALL_PACKAGES" />
`
    : '';

  const launcherActivity = config.includeMaterialYouUi
    ? `        <receiver
            android:name=".PinSpoofStatsReceiver"
            android:exported="true">
            <intent-filter>
                <action android:name="${pkg}.ACTION_HOOK_STATS" />
            </intent-filter>
        </receiver>

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:enableOnBackInvokedCallback="true"
            android:theme="@android:style/Theme.Material.NoActionBar">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="de.robv.android.xposed.category.MODULE_SETTINGS" />
            </intent-filter>
        </activity>`
    : '';

  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

${permissions}
    <application
        android:allowBackup="false"
        android:label="@string/app_name"
        android:supportsRtl="true">

        <meta-data
            android:name="xposedmodule"
            android:value="true" />
        <meta-data
            android:name="xposeddescription"
            android:value="@string/xposed_description" />
        <meta-data
            android:name="xposedminversion"
            android:value="93" />
        <meta-data
            android:name="xposedsharedprefs"
            android:value="true" />
${scopeMeta}

${launcherActivity}
    </application>

</manifest>
`;
}

function generateStringsXml(config: ModuleConfig): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${config.moduleName}</string>
    <string name="xposed_description">Disables system app pinning, spoofs LockTask pinned state, and hides focus loss inside scoped app processes (Android 7–16, no system_server scope).</string>
</resources>
`;
}

function generateArraysXml(scopes: string[]): string {
  if (scopes.length === 0) {
    return `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Add package names here if you want LSPosed to suggest recommended target apps.
         Never add "android" — this module operates strictly inside app processes. -->
    <string-array name="xposed_scope" />
</resources>
`;
  }
  const items = scopes.map((s) => `        <item>${s}</item>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string-array name="xposed_scope">
${items}
    </string-array>
</resources>
`;
}

function generateAppBuildGradle(config: ModuleConfig, pkg: string): string {
  const folderName = config.moduleName.trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'PinSpoof';
  const composeBlock = config.includeMaterialYouUi
    ? `
    buildFeatures {
        compose = true
    }
`
    : '';

  const composePlugins = config.includeMaterialYouUi
    ? `
    id("org.jetbrains.kotlin.plugin.compose")`
    : '';

  const composeDeps = config.includeMaterialYouUi
    ? `
    implementation(platform("androidx.compose:compose-bom:2026.03.01"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material:material-icons-extended")
    // Material 3 1.5.0-alpha15 provides MaterialExpressiveTheme while targeting minCompileSdk 35 (compatible with Android 16 / compileSdk 36)
    implementation("androidx.compose.material3:material3:1.5.0-alpha15")`
    : '';

  return `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")${composePlugins}
}

base {
    archivesName.set("${folderName}-v${config.versionName}")
}

android {
    namespace = "${pkg}"
    compileSdk = ${config.targetSdk}

    defaultConfig {
        applicationId = "${pkg}"
        minSdk = ${config.minSdk}
        targetSdk = ${config.targetSdk}
        versionCode = ${config.versionCode}
        versionName = "${config.versionName}"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("debug")
        }
        debug {
            isMinifyEnabled = false
        }
    }
${composeBlock}
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // Must be compileOnly — LSPosed provides the Xposed runtime classes at injection time
    compileOnly("de.robv.android.xposed:api:82")${composeDeps}
}
`;
}

function generateRootBuildGradle(config: ModuleConfig): string {
  const composePlugin = config.includeMaterialYouUi
    ? `\n    id("org.jetbrains.kotlin.plugin.compose") version "2.1.20" apply false`
    : '';
  return `plugins {
    // AGP 8.9.1+ required for Android 16 (compileSdk = 36)
    id("com.android.application") version "8.9.1" apply false
    id("org.jetbrains.kotlin.android") version "2.1.20" apply false${composePlugin}
}
`;
}

function generateSettingsGradle(config: ModuleConfig): string {
  return `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven { url = uri("https://api.xposed.info/") }
    }
}

rootProject.name = "${config.moduleName}"
include(":app")
`;
}

function generateGradleWrapperProperties(): string {
  return `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.11.1-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`;
}

function generateGradleProperties(): string {
  return `org.gradle.jvmargs=-Xmx3072m -Dfile.encoding=UTF-8
android.useAndroidX=true
kotlin.code.style=official
android.nonTransitiveRClass=true
`;
}

function generateProguardRules(pkg: string): string {
  return `# Keep the Xposed entry class referenced by assets/xposed_init
-keep class ${pkg}.PinSpoofModule { *; }
-keep class ${pkg}.HookConfig { *; }
-keep class ${pkg}.prefs.** { *; }
-dontwarn de.robv.android.xposed.**
`;
}

function generateGithubWorkflow(config: ModuleConfig): string {
  const folderName = config.moduleName.trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'PinSpoof';
  const ver = config.versionName.trim() || '1.2.0';
  return `name: Build ${config.moduleName} APK & Morphe Patches

on:
  push:
    branches: [ main, master ]
  workflow_dispatch:

jobs:
  build-apk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Locate Gradle project root
        id: gradle_root
        run: |
          if [ -f "settings.gradle.kts" ]; then
            echo "dir=." >> "$GITHUB_OUTPUT"
          else
            SETTINGS_PATH=$(find . -maxdepth 3 -name "settings.gradle.kts" ! -path "*/morphe-patches/*" -print -quit)
            if [ -z "$SETTINGS_PATH" ]; then
              echo "Error: root settings.gradle.kts not found in repository."
              exit 1
            fi
            echo "dir=$(dirname "$SETTINGS_PATH")" >> "$GITHUB_OUTPUT"
          fi

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17

      - name: Install Android SDK Platform ${config.targetSdk} & Build Tools
        run: |
          SDKMANAGER=$(command -v sdkmanager || find "$ANDROID_HOME/cmdline-tools" -name sdkmanager -type f | head -n 1)
          if [ -z "$SDKMANAGER" ]; then
            echo "Error: sdkmanager not found under ANDROID_HOME=$ANDROID_HOME"
            exit 1
          fi
          yes | "$SDKMANAGER" --licenses >/dev/null 2>&1 || true
          "$SDKMANAGER" "platforms;android-${config.targetSdk}" "build-tools;${config.targetSdk}.0.0"

      - name: Setup Gradle
        uses: gradle/actions/setup-gradle@v4
        with:
          gradle-version: 8.11.1

      - name: Build Debug & Release APKs (API ${config.targetSdk})
        working-directory: \${{ steps.gradle_root.outputs.dir }}
        run: gradle assembleDebug assembleRelease

      - name: Stage ${folderName}-v${ver}.apk Release & Debug Outputs
        working-directory: \${{ steps.gradle_root.outputs.dir }}
        run: |
          mkdir -p dist-apks
          RELEASE_APK=$(find app/build/outputs/apk/release -name "*.apk" | head -n 1)
          DEBUG_APK=$(find app/build/outputs/apk/debug -name "*.apk" | head -n 1)
          cp "$RELEASE_APK" "dist-apks/${folderName}-v${ver}.apk"
          cp "$DEBUG_APK" "dist-apks/${folderName}-v${ver}-debug.apk"

      - name: Upload APK Artifacts
        uses: actions/upload-artifact@v4
        with:
          name: ${folderName}-apks
          path: \${{ steps.gradle_root.outputs.dir }}/dist-apks/*.apk

  build-morphe-patches:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: read
    steps:
      - uses: actions/checkout@v4

      - name: Locate Morphe Patches root
        id: morphe_root
        run: |
          if [ -f "morphe-patches/settings.gradle.kts" ]; then
            echo "dir=morphe-patches" >> "$GITHUB_OUTPUT"
          else
            MORPHE_SETTINGS=$(find . -maxdepth 3 -path "*/morphe-patches/settings.gradle.kts" -print -quit)
            if [ -z "$MORPHE_SETTINGS" ]; then
              echo "Error: morphe-patches/settings.gradle.kts not found."
              exit 1
            fi
            echo "dir=$(dirname "$MORPHE_SETTINGS")" >> "$GITHUB_OUTPUT"
          fi

      - name: Set up JDK 21
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 21

      - name: Install Android SDK Platform ${config.targetSdk} & Build Tools
        run: |
          SDKMANAGER=$(command -v sdkmanager || find "$ANDROID_HOME/cmdline-tools" -name sdkmanager -type f | head -n 1)
          if [ -z "$SDKMANAGER" ]; then
            echo "Error: sdkmanager not found under ANDROID_HOME=$ANDROID_HOME"
            exit 1
          fi
          yes | "$SDKMANAGER" --licenses >/dev/null 2>&1 || true
          "$SDKMANAGER" "platforms;android-${config.targetSdk}" "build-tools;${config.targetSdk}.0.0"

      - name: Setup Gradle 9.9.1
        uses: gradle/actions/setup-gradle@v4
        with:
          gradle-version: 9.9.1

      - name: Build Morphe Patch Bundle (.mpp) & Patches List
        working-directory: \${{ steps.morphe_root.outputs.dir }}
        env:
          GITHUB_ACTOR: \${{ github.actor }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: gradle :patches:buildAndroid :patches:generatePatchesList --no-daemon

      - name: Stage ${folderName}-v${ver}.mpp Bundle & Patches List
        working-directory: \${{ steps.morphe_root.outputs.dir }}
        run: |
          mkdir -p dist-patches
          MPP_FILE=$(find patches/build/libs -maxdepth 1 -name "*.mpp" | head -n 1)
          cp "$MPP_FILE" "dist-patches/${folderName}-v${ver}.mpp"
          cp "patches-list.json" "dist-patches/patches-list.json"

      - name: Upload Morphe Patch Artifacts
        uses: actions/upload-artifact@v4
        with:
          name: ${folderName}-morphe-patches
          path: \${{ steps.morphe_root.outputs.dir }}/dist-patches/*
`;
}

function generateMorphePatchKt(config: ModuleConfig, pkg: string): string {
  const extPrefix = `L${pkg.replace(/\./g, '/')}/extension/`;
  const extClass = `${extPrefix}PinSpoofHooks;`;
  return `package ${pkg}.patches

import app.morphe.patcher.Fingerprint
import app.morphe.patcher.extensions.InstructionExtensions.addInstructions
import app.morphe.patcher.extensions.InstructionExtensions.getInstruction
import app.morphe.patcher.extensions.InstructionExtensions.replaceInstruction
import app.morphe.patcher.methodCall
import app.morphe.patcher.patch.BytecodePatchContext
import app.morphe.patcher.patch.booleanOption
import app.morphe.patcher.patch.bytecodePatch
import app.morphe.patcher.patch.stringOption
import app.morphe.patcher.util.cloneParameters
import app.morphe.patcher.util.findFreeRegister
import app.morphe.patcher.util.matchAllMethodIndicesForEach
import app.morphe.patcher.util.numberOfParameterRegistersLogical
import app.morphe.patcher.util.p0Register
import app.morphe.patcher.util.proxy.mutableTypes.MutableMethod
import app.morphe.patcher.util.registersUsed
import app.morphe.patcher.util.returnEarly
import com.android.tools.smali.dexlib2.Opcode
import com.android.tools.smali.dexlib2.iface.ClassDef
import com.android.tools.smali.dexlib2.iface.instruction.ReferenceInstruction
import com.android.tools.smali.dexlib2.iface.reference.MethodReference

private const val EXTENSION_PREFIX = "${extPrefix}"
private const val EXTENSION_CLASS = "${extClass}"

private val ACTIVITY_BASE_TYPES = setOf(
    "Landroid/app/Activity;",
    "Landroidx/activity/ComponentActivity;",
    "Landroidx/fragment/app/FragmentActivity;",
    "Landroidx/appcompat/app/AppCompatActivity;",
)

private val FRAGMENT_BASE_TYPES = setOf(
    "Landroidx/fragment/app/Fragment;",
    "Landroid/app/Fragment;",
)

private val VIEW_BASE_TYPES = setOf(
    "Landroid/view/View;",
    "Landroid/view/ViewGroup;",
    "Landroid/widget/FrameLayout;",
    "Landroid/webkit/WebView;",
)

private val WEBVIEW_BASE_TYPES = setOf(
    "Landroid/webkit/WebView;",
)

private val WEBVIEW_CLIENT_BASE_TYPES = setOf(
    "Landroid/webkit/WebViewClient;",
)

private val WINDOW_BASE_TYPES = setOf(
    "Landroid/view/Window;",
)

private val SURFACE_VIEW_BASE_TYPES = setOf(
    "Landroid/view/SurfaceView;",
)

@Suppress("unused")
val pinSpoofPatch = bytecodePatch(
    name = "${config.moduleName}",
    description = "Disables app pinning (LockTask), spoofs pinned state, and hides focus/Recents loss directly in patched APKs without root or Xposed.",
    default = false,
) {
    val spoofTiming by stringOption(
        key = "spoofTiming",
        default = "${config.spoofTiming}",
        values = mapOf(
            "Reactive (after startLockTask)" to "reactive",
            "Always Pinned (from launch)" to "always",
        ),
        title = "Spoof Timing Mode",
        description = "Reactive (recommended) spoofs pinned state only after startLockTask(); Always Pinned forces pinned from launch.",
    )

    val hookActivityLockTask by booleanOption(
        key = "hookActivityLockTask",
        default = ${config.hookActivityLockTask},
        title = "Disable Pinning (startLockTask / stopLockTask)",
        description = "Swallow Activity.startLockTask() and stopLockTask() calls so Android never enters Screen Pinning.",
    )

    val hookActivityManagerState by booleanOption(
        key = "hookActivityManagerState",
        default = ${config.hookActivityManagerState},
        title = "Spoof ActivityManager Pin State",
        description = "Return LOCK_TASK_MODE_PINNED (2) for getLockTaskModeState() and true for isInLockTaskMode().",
    )

    val hookBinderProxies by booleanOption(
        key = "hookBinderProxies",
        default = ${config.hookBinderProxies},
        title = "Binder Stub\\$Proxy LockTask Interception (Advanced)",
        description = "OFF by default: rewrite internal IActivityTaskManager/IActivityManager LockTask IPC calls directly.",
    )

    val hideFocusLoss by booleanOption(
        key = "hideFocusLoss",
        default = ${config.hideFocusLoss},
        title = "Window Focus Spoofing (Safe)",
        description = "Drop onWindowFocusChanged(false), onTopResumedActivityChanged(false), onUserLeaveHint(), and spoof hasWindowFocus() & IMPORTANCE_FOREGROUND.",
    )

    val hideWebViewVisibility by booleanOption(
        key = "hideWebViewVisibility",
        default = ${config.hideWebViewVisibility},
        title = "WebView Visibility, JS & Pause Stealth",
        description = "Force WebView visibility VISIBLE, block WebView.onPause()/pauseTimers(), and inject DOM Page Visibility / blur stealth JS.",
    )

    val hideLifecycleLoss by booleanOption(
        key = "hideLifecycleLoss",
        default = ${config.hideLifecycleLoss},
        title = "Suppress onPause / onStop (Advanced)",
        description = "OFF by default: block Activity/Fragment onPause(), onStop(), ActivityLifecycleCallbacks, and LifecycleRegistry transitions.",
    )

    val hideMultiWindowAndPip by booleanOption(
        key = "hideMultiWindowAndPip",
        default = ${config.hideMultiWindowAndPip},
        title = "Hide Multi-Window & Picture-in-Picture",
        description = "Return false for Activity.isInMultiWindowMode() and isInPictureInPictureMode().",
    )

    val spoofPinnedInsets by booleanOption(
        key = "spoofPinnedInsets",
        default = ${config.spoofPinnedInsets},
        title = "Simulate Pinned Window Insets",
        description = "Report zeroed system bar WindowInsets while keeping your actual navigation bar and gestures usable.",
    )

    val stripFlagSecure by booleanOption(
        key = "stripFlagSecure",
        default = ${config.stripFlagSecure},
        title = "Strip FLAG_SECURE",
        description = "Clear FLAG_SECURE on Windows and SurfaceViews so screenshots and recordings remain available.",
    )

    val hideAccessibilityAndOverlays by booleanOption(
        key = "hideAccessibilityAndOverlays",
        default = ${config.hideAccessibilityAndOverlays},
        title = "Hide Accessibility & Overlay Checks",
        description = "Return empty AccessibilityManager service list and false for Settings.canDrawOverlays().",
    )

    val retainAudioFocus by booleanOption(
        key = "retainAudioFocus",
        default = ${config.retainAudioFocus},
        title = "Retain Audio Focus",
        description = "Suppress negative AudioManager.OnAudioFocusChangeListener notifications when interruptions occur.",
    )

    val hookSettingsLockToApp by booleanOption(
        key = "hookSettingsLockToApp",
        default = ${config.hookSettingsLockToApp},
        title = "Spoof Settings.System lock_to_app_enabled",
        description = "Return 1 when the target app queries Settings.System lock_to_app_enabled.",
    )

    val hookDevicePolicyPermitted by booleanOption(
        key = "hookDevicePolicyPermitted",
        default = ${config.hookDevicePolicyPermitted},
        title = "Spoof DevicePolicyManager.isLockTaskPermitted",
        description = "Return true when the target app checks DevicePolicyManager.isLockTaskPermitted().",
    )

    val debugLogging by booleanOption(
        key = "debugLogging",
        default = ${config.debugLogging},
        title = "Verbose Logcat Debug Logging",
        description = "Emit Log.d(\\"${config.moduleName}\\", ...) traces when patched hooks intercept pinning or focus events.",
    )

    extendWith("extensions/extension.mpe")

    execute {
        val alwaysPinned = spoofTiming == "always"
        Fingerprint(definingClass = EXTENSION_CLASS, name = "alwaysSpoofPinned")
            .method
            .returnEarly(alwaysPinned)
        Fingerprint(definingClass = EXTENSION_CLASS, name = "debugLogging")
            .method
            .returnEarly(debugLogging == true)

        if (hookActivityLockTask == true) {
            rewriteInstanceCalls(
                methodName = "startLockTask",
                parameters = emptyList(),
                returnType = "V",
                matchesReceiver = { isActivityType(it) },
                targetMethod = "$EXTENSION_CLASS->startLockTask(Landroid/app/Activity;)V",
            )
            rewriteInstanceCalls(
                methodName = "stopLockTask",
                parameters = emptyList(),
                returnType = "V",
                matchesReceiver = { isActivityType(it) },
                targetMethod = "$EXTENSION_CLASS->stopLockTask(Landroid/app/Activity;)V",
            )
            swallowLockTaskTokenCalls(includeBinderProxies = hookBinderProxies == true)
        }

        if (hookActivityManagerState == true) {
            rewriteInstanceCalls(
                methodName = "getLockTaskModeState",
                parameters = emptyList(),
                returnType = "I",
                matchesReceiver = { it == "Landroid/app/ActivityManager;" },
                targetMethod = "$EXTENSION_CLASS->getLockTaskModeState(Landroid/app/ActivityManager;)I",
            )
            rewriteInstanceCalls(
                methodName = "isInLockTaskMode",
                parameters = emptyList(),
                returnType = "Z",
                matchesReceiver = { it == "Landroid/app/ActivityManager;" },
                targetMethod = "$EXTENSION_CLASS->isInLockTaskMode(Landroid/app/ActivityManager;)Z",
            )
        }

        if (hideFocusLoss == true) {
            rewriteInstanceCalls(
                methodName = "hasWindowFocus",
                parameters = emptyList(),
                returnType = "Z",
                matchesReceiver = { isActivityType(it) },
                targetMethod = "$EXTENSION_CLASS->hasWindowFocus(Landroid/app/Activity;)Z",
            )
            rewriteInstanceCalls(
                methodName = "hasWindowFocus",
                parameters = emptyList(),
                returnType = "Z",
                matchesReceiver = { isViewType(it) },
                targetMethod = "$EXTENSION_CLASS->hasWindowFocus(Landroid/view/View;)Z",
            )
            methodCall(
                smali = "Landroid/app/ActivityManager;->getMyMemoryState(Landroid/app/ActivityManager\\$RunningAppProcessInfo;)V"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "$EXTENSION_CLASS->getMyMemoryState(Landroid/app/ActivityManager\\$RunningAppProcessInfo;)V",
                    )
                }
            }
        }

        if (hideWebViewVisibility == true) {
            rewriteInstanceCalls(
                methodName = "onPause",
                parameters = emptyList(),
                returnType = "V",
                matchesReceiver = { isWebViewType(it) },
                targetMethod = "$EXTENSION_CLASS->onWebViewPause(Landroid/webkit/WebView;)V",
            )
            rewriteInstanceCalls(
                methodName = "pauseTimers",
                parameters = emptyList(),
                returnType = "V",
                matchesReceiver = { isWebViewType(it) },
                targetMethod = "$EXTENSION_CLASS->onWebViewPauseTimers(Landroid/webkit/WebView;)V",
            )
        }

        if (hideMultiWindowAndPip == true) {
            rewriteInstanceCalls(
                methodName = "isInMultiWindowMode",
                parameters = emptyList(),
                returnType = "Z",
                matchesReceiver = { isActivityType(it) },
                targetMethod = "$EXTENSION_CLASS->isInMultiWindowMode(Landroid/app/Activity;)Z",
            )
            rewriteInstanceCalls(
                methodName = "isInPictureInPictureMode",
                parameters = emptyList(),
                returnType = "Z",
                matchesReceiver = { isActivityType(it) },
                targetMethod = "$EXTENSION_CLASS->isInPictureInPictureMode(Landroid/app/Activity;)Z",
            )
        }

        if (spoofPinnedInsets == true) {
            rewriteInstanceCalls(
                methodName = "getInsets",
                parameters = listOf("I"),
                returnType = "Landroid/graphics/Insets;",
                matchesReceiver = { it == "Landroid/view/WindowInsets;" },
                targetMethod = "$EXTENSION_CLASS->getWindowInsets(Landroid/view/WindowInsets;I)Landroid/graphics/Insets;",
            )
            rewriteInstanceCalls(
                methodName = "isVisible",
                parameters = listOf("I"),
                returnType = "Z",
                matchesReceiver = { it == "Landroid/view/WindowInsets;" },
                targetMethod = "$EXTENSION_CLASS->isWindowInsetsVisible(Landroid/view/WindowInsets;I)Z",
            )
            listOf(
                "getSystemWindowInsetTop",
                "getSystemWindowInsetBottom",
                "getSystemWindowInsetLeft",
                "getSystemWindowInsetRight",
            ).forEach { insetMethod ->
                rewriteInstanceCalls(
                    methodName = insetMethod,
                    parameters = emptyList(),
                    returnType = "I",
                    matchesReceiver = { it == "Landroid/view/WindowInsets;" },
                    targetMethod = "$EXTENSION_CLASS->getZeroSystemInset(Landroid/view/WindowInsets;)I",
                )
            }
        }

        if (stripFlagSecure == true) {
            rewriteInstanceCalls(
                methodName = "setFlags",
                parameters = listOf("I", "I"),
                returnType = "V",
                matchesReceiver = { isWindowType(it) },
                targetMethod = "$EXTENSION_CLASS->windowSetFlags(Landroid/view/Window;II)V",
            )
            rewriteInstanceCalls(
                methodName = "addFlags",
                parameters = listOf("I"),
                returnType = "V",
                matchesReceiver = { isWindowType(it) },
                targetMethod = "$EXTENSION_CLASS->windowAddFlags(Landroid/view/Window;I)V",
            )
            rewriteInstanceCalls(
                methodName = "setSecure",
                parameters = listOf("Z"),
                returnType = "V",
                matchesReceiver = { isSurfaceViewType(it) },
                targetMethod = "$EXTENSION_CLASS->surfaceViewSetSecure(Landroid/view/SurfaceView;Z)V",
            )
        }

        if (hideAccessibilityAndOverlays == true) {
            methodCall(
                smali = "Landroid/view/accessibility/AccessibilityManager;->getEnabledAccessibilityServiceList(I)Ljava/util/List;"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "$EXTENSION_CLASS->getEnabledAccessibilityServiceList(Landroid/view/accessibility/AccessibilityManager;I)Ljava/util/List;",
                    )
                }
            }
            methodCall(
                smali = "Landroid/provider/Settings;->canDrawOverlays(Landroid/content/Context;)Z"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "$EXTENSION_CLASS->canDrawOverlays(Landroid/content/Context;)Z",
                    )
                }
            }
        }

        if (hookSettingsLockToApp == true) {
            methodCall(
                smali = "Landroid/provider/Settings\\$System;->getInt(Landroid/content/ContentResolver;Ljava/lang/String;I)I"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "$EXTENSION_CLASS->getSettingsSystemInt(Landroid/content/ContentResolver;Ljava/lang/String;I)I",
                    )
                }
            }
            methodCall(
                smali = "Landroid/provider/Settings\\$System;->getInt(Landroid/content/ContentResolver;Ljava/lang/String;)I"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "$EXTENSION_CLASS->getSettingsSystemInt(Landroid/content/ContentResolver;Ljava/lang/String;)I",
                    )
                }
            }
        }

        if (hookDevicePolicyPermitted == true) {
            methodCall(
                smali = "Landroid/app/admin/DevicePolicyManager;->isLockTaskPermitted(Ljava/lang/String;)Z"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "$EXTENSION_CLASS->isLockTaskPermitted(Landroid/app/admin/DevicePolicyManager;Ljava/lang/String;)Z",
                    )
                }
            }
        }

        if (hideFocusLoss == true ||
            hideWebViewVisibility == true ||
            hideLifecycleLoss == true ||
            retainAudioFocus == true
        ) {
            patchAppSubclassOverrides(
                hideFocus = hideFocusLoss == true,
                hideWebView = hideWebViewVisibility == true,
                hideLifecycle = hideLifecycleLoss == true,
                retainAudio = retainAudioFocus == true,
            )
        }
    }
}

private fun BytecodePatchContext.isFrameworkType(type: String): Boolean =
    type.startsWith("Landroid/") ||
        type.startsWith("Landroidx/") ||
        type.startsWith("Lcom/android/") ||
        type.startsWith("Ljava/") ||
        type.startsWith("Lkotlin/") ||
        type.startsWith("Lkotlinx/") ||
        type.startsWith(EXTENSION_PREFIX)

private fun BytecodePatchContext.hasAncestorIn(classType: String, targets: Set<String>): Boolean {
    var current: String? = classType
    var depth = 0
    while (current != null && depth < 32) {
        if (current in targets) return true
        val def = classDefByOrNull(current) ?: break
        current = def.superclass
        depth++
    }
    return false
}

private fun BytecodePatchContext.isActivityType(classType: String): Boolean =
    hasAncestorIn(classType, ACTIVITY_BASE_TYPES)

private fun BytecodePatchContext.isFragmentType(classType: String): Boolean =
    hasAncestorIn(classType, FRAGMENT_BASE_TYPES)

private fun BytecodePatchContext.isViewType(classType: String): Boolean =
    hasAncestorIn(classType, VIEW_BASE_TYPES)

private fun BytecodePatchContext.isWebViewType(classType: String): Boolean =
    hasAncestorIn(classType, WEBVIEW_BASE_TYPES)

private fun BytecodePatchContext.isWebViewClientType(classType: String): Boolean =
    hasAncestorIn(classType, WEBVIEW_CLIENT_BASE_TYPES)

private fun BytecodePatchContext.isWindowType(classType: String): Boolean =
    hasAncestorIn(classType, WINDOW_BASE_TYPES)

private fun BytecodePatchContext.isSurfaceViewType(classType: String): Boolean =
    hasAncestorIn(classType, SURFACE_VIEW_BASE_TYPES)

private fun BytecodePatchContext.rewriteInstanceCalls(
    methodName: String,
    parameters: List<String>,
    returnType: String,
    matchesReceiver: BytecodePatchContext.(String) -> Boolean,
    targetMethod: String,
) {
    methodCall(
        name = methodName,
        parameters = parameters,
        returnType = returnType,
    ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
        if (definingClass.startsWith(EXTENSION_PREFIX)) return@matchAllMethodIndicesForEach
        val insn = getInstruction(index)
        if (insn.opcode == Opcode.INVOKE_SUPER || insn.opcode == Opcode.INVOKE_SUPER_RANGE) {
            return@matchAllMethodIndicesForEach
        }
        val ref = (insn as? ReferenceInstruction)?.reference as? MethodReference ?: return@matchAllMethodIndicesForEach
        if (!matchesReceiver(ref.definingClass)) return@matchAllMethodIndicesForEach
        replaceCallAt(index, targetMethod)
    }
}

private fun BytecodePatchContext.swallowLockTaskTokenCalls(includeBinderProxies: Boolean) {
    listOf("startLockTaskModeByToken", "startLockTaskMode").forEach { name ->
        methodCall(
            name = name,
            returnType = "V",
        ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
            if (definingClass.startsWith(EXTENSION_PREFIX)) return@matchAllMethodIndicesForEach
            val ref = (getInstruction(index) as? ReferenceInstruction)?.reference as? MethodReference
                ?: return@matchAllMethodIndicesForEach
            val isClient = ref.definingClass == "Landroid/app/ActivityClient;"
            val isBinder = includeBinderProxies && ref.definingClass.startsWith("Landroid/app/IActivity")
            if (isClient || isBinder) {
                replaceInstruction(index, "invoke-static {}, $EXTENSION_CLASS->onLockTaskTokenCall()V")
            }
        }
    }
}

private fun MutableMethod.replaceCallAt(index: Int, targetMethod: String) {
    val insn = getInstruction(index)
    val regs = insn.registersUsed
    val useRange = insn.opcode.name.endsWith("_RANGE") || regs.any { it > 15 }
    val invokeSmali = when {
        regs.isEmpty() -> "invoke-static {}, $targetMethod"
        useRange -> "invoke-static/range { v\${regs.first()} .. v\${regs.last()} }, $targetMethod"
        else -> "invoke-static { \${regs.joinToString(", ") { "v$it" }} }, $targetMethod"
    }
    replaceInstruction(index, invokeSmali)
}

private fun BytecodePatchContext.patchAppSubclassOverrides(
    hideFocus: Boolean,
    hideWebView: Boolean,
    hideLifecycle: Boolean,
    retainAudio: Boolean,
) {
    val activityTargets = mutableListOf<ClassDef>()
    val fragmentTargets = mutableListOf<ClassDef>()
    val viewTargets = mutableListOf<ClassDef>()
    val webViewClientTargets = mutableListOf<ClassDef>()
    val lifecycleCallbackTargets = mutableListOf<ClassDef>()
    val focusListenerTargets = mutableListOf<ClassDef>()
    val audioListenerTargets = mutableListOf<ClassDef>()

    classDefForEach { classDef ->
        val type = classDef.type
        if (isFrameworkType(type)) return@classDefForEach

        if ((hideFocus || hideLifecycle) && isActivityType(type)) {
            val hasActivityHook = classDef.methods.any { m ->
                m.implementation != null && (
                    (hideFocus && ((m.name == "onWindowFocusChanged" && m.parameterTypes == listOf("Z") && m.returnType == "V") ||
                        (m.name == "onTopResumedActivityChanged" && m.parameterTypes == listOf("Z") && m.returnType == "V") ||
                        (m.name == "onUserLeaveHint" && m.parameterTypes.isEmpty() && m.returnType == "V"))) ||
                        (hideLifecycle && ((m.name == "onUserLeaveHint" && m.parameterTypes.isEmpty() && m.returnType == "V") ||
                            (m.name == "onPause" && m.parameterTypes.isEmpty() && m.returnType == "V") ||
                            (m.name == "onStop" && m.parameterTypes.isEmpty() && m.returnType == "V") ||
                            (m.name == "onTopResumedActivityChanged" && m.parameterTypes == listOf("Z") && m.returnType == "V")))
                    )
            }
            if (hasActivityHook) activityTargets += classDef
        }

        if (hideLifecycle && isFragmentType(type)) {
            val hasFragHook = classDef.methods.any { m ->
                m.implementation != null &&
                    (m.name == "onPause" || m.name == "onStop") &&
                    m.parameterTypes.isEmpty() &&
                    m.returnType == "V"
            }
            if (hasFragHook) fragmentTargets += classDef
        }

        if ((hideFocus || hideWebView) && isViewType(type)) {
            val hasViewHook = classDef.methods.any { m ->
                m.implementation != null && (
                    (hideFocus && m.name == "onWindowFocusChanged" && m.parameterTypes == listOf("Z") && m.returnType == "V") ||
                        (hideWebView && m.name == "onWindowVisibilityChanged" && m.parameterTypes == listOf("I") && m.returnType == "V")
                    )
            }
            if (hasViewHook) viewTargets += classDef
        }

        if (hideWebView && isWebViewClientType(type)) {
            val hasPageFinished = classDef.methods.any { m ->
                m.implementation != null &&
                    m.name == "onPageFinished" &&
                    m.parameterTypes == listOf("Landroid/webkit/WebView;", "Ljava/lang/String;") &&
                    m.returnType == "V"
            }
            if (hasPageFinished) webViewClientTargets += classDef
        }

        if (hideLifecycle && "Landroid/app/Application\\$ActivityLifecycleCallbacks;" in classDef.interfaces) {
            val hasCb = classDef.methods.any { m ->
                m.implementation != null &&
                    (m.name == "onActivityPaused" || m.name == "onActivityStopped") &&
                    m.parameterTypes == listOf("Landroid/app/Activity;") &&
                    m.returnType == "V"
            }
            if (hasCb) lifecycleCallbackTargets += classDef
        }

        if (hideFocus && "Landroid/view/ViewTreeObserver\\$OnWindowFocusChangeListener;" in classDef.interfaces) {
            val hasListener = classDef.methods.any { m ->
                m.implementation != null &&
                    m.name == "onWindowFocusChanged" &&
                    m.parameterTypes == listOf("Z") &&
                    m.returnType == "V"
            }
            if (hasListener) focusListenerTargets += classDef
        }

        if (retainAudio && "Landroid/media/AudioManager\\$OnAudioFocusChangeListener;" in classDef.interfaces) {
            val hasAudio = classDef.methods.any { m ->
                m.implementation != null &&
                    m.name == "onAudioFocusChange" &&
                    m.parameterTypes == listOf("I") &&
                    m.returnType == "V"
            }
            if (hasAudio) audioListenerTargets += classDef
        }
    }

    activityTargets.forEach { classDef ->
        val superType = classDef.superclass ?: "Landroid/app/Activity;"
        val mutable = mutableClassDefBy(classDef)
        for (method in mutable.methods.toList()) {
            if (method.implementation == null) continue
            when {
                hideFocus &&
                    method.name == "onWindowFocusChanged" &&
                    method.parameterTypes == listOf("Z") &&
                    method.returnType == "V" -> {
                    skipWhenBooleanParamFalse(method)
                }
                (hideFocus || hideLifecycle) &&
                    method.name == "onTopResumedActivityChanged" &&
                    method.parameterTypes == listOf("Z") &&
                    method.returnType == "V" -> {
                    skipWhenBooleanParamFalse(method)
                }
                (hideFocus || hideLifecycle) &&
                    method.name == "onUserLeaveHint" &&
                    method.parameterTypes.isEmpty() &&
                    method.returnType == "V" -> {
                    bypassActivityLifecycleMethod(method, superType, "onUserLeaveHint", callSuper = false)
                }
                hideLifecycle &&
                    method.name == "onPause" &&
                    method.parameterTypes.isEmpty() &&
                    method.returnType == "V" -> {
                    bypassActivityLifecycleMethod(method, superType, "onPause", callSuper = true)
                }
                hideLifecycle &&
                    method.name == "onStop" &&
                    method.parameterTypes.isEmpty() &&
                    method.returnType == "V" -> {
                    bypassActivityLifecycleMethod(method, superType, "onStop", callSuper = true)
                }
            }
        }
    }

    fragmentTargets.forEach { classDef ->
        val superType = classDef.superclass ?: "Landroidx/fragment/app/Fragment;"
        val mutable = mutableClassDefBy(classDef)
        for (method in mutable.methods.toList()) {
            if (method.implementation == null) continue
            if ((method.name == "onPause" || method.name == "onStop") &&
                method.parameterTypes.isEmpty() &&
                method.returnType == "V"
            ) {
                bypassFragmentLifecycleMethod(method, superType, method.name)
            }
        }
    }

    viewTargets.forEach { classDef ->
        val mutable = mutableClassDefBy(classDef)
        for (method in mutable.methods.toList()) {
            if (method.implementation == null) continue
            if (hideFocus &&
                method.name == "onWindowFocusChanged" &&
                method.parameterTypes == listOf("Z") &&
                method.returnType == "V"
            ) {
                skipWhenBooleanParamFalse(method)
            } else if (hideWebView &&
                method.name == "onWindowVisibilityChanged" &&
                method.parameterTypes == listOf("I") &&
                method.returnType == "V"
            ) {
                forceWindowVisibilityVisible(method)
            }
        }
    }

    webViewClientTargets.forEach { classDef ->
        val mutable = mutableClassDefBy(classDef)
        for (method in mutable.methods.toList()) {
            if (method.implementation == null) continue
            if (method.name == "onPageFinished" &&
                method.parameterTypes == listOf("Landroid/webkit/WebView;", "Ljava/lang/String;") &&
                method.returnType == "V"
            ) {
                method.addInstructions(
                    0,
                    "invoke-static/range { p1 .. p1 }, $EXTENSION_CLASS->injectWebViewStealth(Landroid/webkit/WebView;)V",
                )
            }
        }
    }

    lifecycleCallbackTargets.forEach { classDef ->
        val mutable = mutableClassDefBy(classDef)
        for (method in mutable.methods.toList()) {
            if (method.implementation == null) continue
            if ((method.name == "onActivityPaused" || method.name == "onActivityStopped") &&
                method.parameterTypes == listOf("Landroid/app/Activity;") &&
                method.returnType == "V"
            ) {
                skipLifecycleCallbackIfNotFinishing(method)
            }
        }
    }

    focusListenerTargets.forEach { classDef ->
        val mutable = mutableClassDefBy(classDef)
        for (method in mutable.methods.toList()) {
            if (method.implementation == null) continue
            if (method.name == "onWindowFocusChanged" &&
                method.parameterTypes == listOf("Z") &&
                method.returnType == "V"
            ) {
                skipWhenBooleanParamFalse(method)
            }
        }
    }

    audioListenerTargets.forEach { classDef ->
        val mutable = mutableClassDefBy(classDef)
        for (method in mutable.methods.toList()) {
            if (method.implementation == null) continue
            if (method.name == "onAudioFocusChange" &&
                method.parameterTypes == listOf("I") &&
                method.returnType == "V"
            ) {
                suppressAudioFocusLoss(method)
            }
        }
    }

    if (hideLifecycle) {
        classDefByOrNull("Landroidx/lifecycle/LifecycleRegistry;")?.let { registryClass ->
            val mutable = mutableClassDefBy(registryClass)
            val handleMethod = mutable.methods.firstOrNull {
                it.implementation != null &&
                    it.name == "handleLifecycleEvent" &&
                    it.parameterTypes == listOf("Landroidx/lifecycle/Lifecycle\\$Event;") &&
                    it.returnType == "V"
            }
            if (handleMethod != null) {
                prepareEntryScratch(handleMethod) { freeReg, _, p1Reg ->
                    """
                        invoke-static/range { $p1Reg .. $p1Reg }, $EXTENSION_CLASS->shouldSuppressLifecycleEvent(Ljava/lang/Object;)Z
                        move-result $freeReg
                        if-eqz $freeReg, :pinspoof_orig
                        return-void
                        :pinspoof_orig
                        nop
                    """.trimIndent()
                }
            }
        }
    }
}

private fun skipWhenBooleanParamFalse(method: MutableMethod) {
    method.addInstructions(
        0,
        """
            if-nez p1, :pinspoof_keep
            return-void
            :pinspoof_keep
            nop
        """.trimIndent(),
    )
}

private fun forceWindowVisibilityVisible(method: MutableMethod) {
    method.addInstructions(
        0,
        """
            invoke-static/range { p1 .. p1 }, $EXTENSION_CLASS->filterWindowVisibility(I)I
            move-result p1
        """.trimIndent(),
    )
}

private fun BytecodePatchContext.suppressAudioFocusLoss(method: MutableMethod) {
    prepareEntryScratch(method) { freeReg, _, p1Reg ->
        """
            invoke-static/range { $p1Reg .. $p1Reg }, $EXTENSION_CLASS->shouldSuppressAudioFocusLoss(I)Z
            move-result $freeReg
            if-eqz $freeReg, :pinspoof_orig
            return-void
            :pinspoof_orig
            nop
        """.trimIndent()
    }
}

private fun BytecodePatchContext.bypassActivityLifecycleMethod(
    method: MutableMethod,
    superType: String,
    methodName: String,
    callSuper: Boolean,
) {
    prepareEntryScratch(method) { freeReg, p0Reg, _ ->
        val superCall = if (callSuper) {
            "invoke-super/range { $p0Reg .. $p0Reg }, $superType->$methodName()V\\n"
        } else {
            ""
        }
        """
            invoke-static/range { $p0Reg .. $p0Reg }, $EXTENSION_CLASS->shouldSuppressLifecycle(Landroid/app/Activity;)Z
            move-result $freeReg
            if-eqz $freeReg, :pinspoof_orig
            \${superCall}return-void
            :pinspoof_orig
            nop
        """.trimIndent()
    }
}

private fun BytecodePatchContext.bypassFragmentLifecycleMethod(
    method: MutableMethod,
    superType: String,
    methodName: String,
) {
    prepareEntryScratch(method) { freeReg, p0Reg, _ ->
        """
            invoke-virtual/range { $p0Reg .. $p0Reg }, $superType->getActivity()Landroid/app/Activity;
            move-result-object $freeReg
            invoke-static/range { $freeReg .. $freeReg }, $EXTENSION_CLASS->shouldSuppressLifecycle(Landroid/app/Activity;)Z
            move-result $freeReg
            if-eqz $freeReg, :pinspoof_orig
            invoke-super/range { $p0Reg .. $p0Reg }, $superType->$methodName()V
            return-void
            :pinspoof_orig
            nop
        """.trimIndent()
    }
}

private fun BytecodePatchContext.skipLifecycleCallbackIfNotFinishing(method: MutableMethod) {
    prepareEntryScratch(method) { freeReg, _, p1Reg ->
        """
            invoke-static/range { $p1Reg .. $p1Reg }, $EXTENSION_CLASS->shouldSuppressLifecycle(Landroid/app/Activity;)Z
            move-result $freeReg
            if-eqz $freeReg, :pinspoof_orig
            return-void
            :pinspoof_orig
            nop
        """.trimIndent()
    }
}

private fun BytecodePatchContext.prepareEntryScratch(
    method: MutableMethod,
    buildSmali: (freeReg: String, p0Reg: String, p1Reg: String) -> String,
) {
    val impl = method.implementation ?: return
    val origP0 = method.p0Register
    val paramRegs = if (origP0 < impl.registerCount) {
        IntArray(impl.registerCount - origP0) { origP0 + it }
    } else {
        intArrayOf()
    }
    val free = runCatching { method.findFreeRegister(0, *paramRegs) }.getOrNull()
    if (free != null && free < 256) {
        method.addInstructions(0, buildSmali("v$free", "p0", "p1"))
        return
    }
    if (impl.registerCount < 250) {
        val cloned = method.cloneParameters()
        val insertIdx = cloned.numberOfParameterRegistersLogical
        cloned.addInstructions(
            insertIdx,
            buildSmali("p0", "v$origP0", "v\${origP0 + 1}"),
        )
    }
}
`;
}

function generateMorpheHooksJava(config: ModuleConfig, pkg: string): string {
  return `package ${pkg}.extension;

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
 * Runtime hook targets merged into the patched APK by ${config.moduleName} v${config.versionName} Morphe Patch.
 * Patch-time options are configured via Morphe Manager / CLI Patching Options.
 */
@SuppressWarnings({"unused", "deprecation"})
public final class PinSpoofHooks {
    private static final String TAG = "${config.moduleName}";
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
`;
}

function generateMorphePatchesBuildGradle(config: ModuleConfig, pkg: string): string {
  return `import org.jetbrains.kotlin.gradle.dsl.JvmTarget

group = "${pkg}"

patches {
    about {
        name = "${config.moduleName} Patches"
        description = "Disable app pinning, spoof LockTask pinned state, and hide focus/Recents loss via Morphe patching options."
        source = "https://github.com/redcatxus/PinSpoof.git"
        author = "redcatx"
        contact = "na"
        website = "https://github.com/redcatxus/PinSpoof"
        license = "GPLv3"
    }
}

val patchListGeneratorClasspath = configurations.create("patchListGeneratorClasspath")

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_11)
    }
}

dependencies {
    compileOnly(libs.gson)
    patchListGeneratorClasspath(libs.gson)
}

tasks {
    register<JavaExec>("generatePatchesList") {
        description = "Build patch list JSON manifest from compiled .mpp bundle"
        dependsOn("buildAndroid")
        classpath = sourceSets["main"].runtimeClasspath + patchListGeneratorClasspath
        mainClass.set("util.PatchListGeneratorKt")
    }

    publish {
        dependsOn("generatePatchesList")
    }
}
`;
}

function generateMorpheSettingsGradle(): string {
  return `rootProject.name = "pinspoof-morphe-patches"

pluginManagement {
    repositories {
        gradlePluginPortal()
        google()
        maven {
            name = "GitHubPackages"
            url = uri("https://maven.pkg.github.com/MorpheApp/registry")
            credentials {
                username = providers.gradleProperty("gpr.user").orNull ?: System.getenv("GITHUB_ACTOR")
                password = providers.gradleProperty("gpr.key").orNull ?: System.getenv("GITHUB_TOKEN")
            }
        }
        maven { url = uri("https://jitpack.io") }
    }
}

plugins {
    id("app.morphe.patches") version "2.1.1"
}
`;
}

function generateMorpheRootBuildGradle(config: ModuleConfig): string {
  return `// Root build configuration for ${config.moduleName} Morphe Patches
`;
}

function generateMorpheGradleProperties(config: ModuleConfig): string {
  return `org.gradle.parallel = true
org.gradle.caching = true
org.gradle.jvmargs = -Xms512M -Xmx2048M
android.useAndroidX = true
kotlin.code.style = official
kotlin.stdlib.default.dependency = false
version = ${config.versionName}
`;
}

function generateMorpheLibsVersionsToml(): string {
  return `[versions]
morphe-patcher = "2.4.0"
#noinspection GradleDependency
smali = "5eaff5a2c9"
gson = "2.15.0"

[libraries]
gson = { module = "com.google.code.gson:gson", version.ref = "gson" }
# Gradle plugin adds the dependency during build; declared here for version tracking.
#noinspection UnusedVersionCatalogEntry
morphe-patcher = { module = "app.morphe:morphe-patcher", version.ref = "morphe-patcher" }
`;
}

function generateMorpheWrapperProperties(): string {
  return `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-9.9.1-bin.zip
networkTimeout=10000
retries=0
retryBackOffMs=500
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`;
}

function generateMorpheExtensionBuildGradle(pkg: string): string {
  return `extension {
    name = "extensions/extension.mpe"
}

android {
    namespace = "${pkg}.extension"
}
`;
}

function generateMorpheExtensionManifest(): string {
  return `<manifest/>
`;
}

function generateMorphePatchListGeneratorKt(): string {
  return `package util

import app.morphe.patcher.patch.Patch
import app.morphe.patcher.patch.loadPatchesFromJar
import com.google.gson.GsonBuilder
import com.google.gson.JsonObject
import java.io.File
import java.net.URLClassLoader
import java.util.jar.Manifest

fun main() {
    val patchFiles = setOf(
        File("build/libs/").listFiles { file ->
            val fileName = file.name
            !fileName.contains("javadoc") &&
                !fileName.contains("sources") &&
                fileName.endsWith(".mpp")
        }!!.first()
    )

    val loadedPatches = loadPatchesFromJar(patchFiles)
    val patchClassLoader = URLClassLoader(patchFiles.map { it.toURI().toURL() }.toTypedArray())
    val manifest = patchClassLoader.getResources("META-INF/MANIFEST.MF")
    while (manifest.hasMoreElements()) {
        Manifest(manifest.nextElement().openStream())
            .mainAttributes
            .getValue("Version")
            ?.let { version ->
                generatePatchList(version, loadedPatches)
            }
    }
}

@Suppress("DEPRECATION")
private fun generatePatchList(version: String, patches: Set<Patch>) {
    val listJson = File("../patches-list.json")
    val patchesMap = patches.sortedBy { it.name }.map { patch ->
        JsonPatch(
            name = patch.name!!,
            description = patch.description,
            default = patch.default,
            category = patch.category,
            compatiblePackages = patch.compatibility?.map { compat ->
                JsonCompatibility(
                    packageName = compat.packageName!!,
                    name = compat.name,
                    description = compat.description,
                    apkFileType = compat.apkFileType?.name,
                    appIconColor = compat.appIconColor?.let { "#%06X".format(it) },
                    signatures = compat.signatures,
                    formFactor = compat.formFactor?.name,
                    targets = compat.targets.map { target ->
                        JsonCompatibility.Target(
                            version = target.version,
                            versionCodes = target.versionCodes?.mapKeys { it.key.name },
                            isExperimental = target.isExperimental,
                            minSdk = target.minSdk,
                            description = target.description,
                        )
                    },
                )
            },
            options = patch.options.values.map { option ->
                JsonPatch.Option(
                    key = option.key,
                    title = option.title,
                    description = option.description,
                    required = option.required,
                    type = option.type.toString(),
                    default = option.default,
                    values = option.values,
                )
            }
        )
    }

    val gson = GsonBuilder()
        .serializeNulls()
        .disableHtmlEscaping()
        .setPrettyPrinting()
        .create()

    val jsonObject = JsonObject()
    jsonObject.addProperty("version", version)
    jsonObject.add("patches", gson.toJsonTree(patchesMap))
    listJson.writeText(gson.toJson(jsonObject))
}

@Suppress("unused")
private class JsonPatch(
    val name: String? = null,
    val description: String? = null,
    val default: Boolean = true,
    val category: String? = null,
    val compatiblePackages: List<JsonCompatibility>? = null,
    val options: List<Option>,
) {
    class Option(
        val key: String,
        val title: String?,
        val description: String?,
        val required: Boolean,
        val type: String,
        val default: Any?,
        val values: Map<String, Any?>?,
    )
}

@Suppress("unused")
private class JsonCompatibility(
    val packageName: String,
    val name: String?,
    val description: String?,
    val apkFileType: String?,
    val appIconColor: String?,
    val signatures: Set<String>?,
    val formFactor: String?,
    val targets: List<Target>,
) {
    class Target(
        val version: String?,
        val versionCodes: Map<String, Int>?,
        val isExperimental: Boolean,
        val minSdk: Int?,
        val description: String?,
    )
}
`;
}

function generateReadme(config: ModuleConfig, pkg: string): string {
  const folderName = config.moduleName.trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'PinSpoof';
  const ver = config.versionName.trim() || '1.2.0';
  return `# ${config.moduleName} v${ver}

App-scoped Xposed (LSPosed / LSPatch) module **and** rootless Morphe Patch Bundle (\`${folderName}-v${ver}.apk\` / \`${folderName}-v${ver}.mpp\`) targeting **Android 7.0 – Android 16 (API ${config.minSdk}–${config.targetSdk})**:

1. **Disables System App Pinning**: Intercepts \`Activity.startLockTask()\`, \`Activity.stopLockTask()\`, \`ActivityClient\`, and optional Binder \`Stub$Proxy\` calls (with dynamic OEM-safe method scanning) inside the target app's ART process before IPC reaches \`system_server\`.
2. **Spoofs Pinned State**: Spoofs \`ActivityManager.getLockTaskModeState()\` -> \`LOCK_TASK_MODE_PINNED\` (\`2\`) and \`isInLockTaskMode()\` -> \`true\` in safe **Reactive** mode by default (or optional **Always Pinned**).
3. **Granular Window, WebView & Lifecycle Stealth**:
   - **Window Focus Spoofing (Safe Default)**: Drops \`View.dispatchWindowFocusChanged(false)\`, \`ViewTreeObserver\`, \`DecorView\`, \`Activity.performTopResumedActivityChanged(false)\`, safe \`onUserLeaveHint()\`, forces \`hasWindowFocus() -> true\`, and keeps \`ActivityManager.getMyMemoryState()\` at \`IMPORTANCE_FOREGROUND\`.
   - **WebView Visibility, JS & Pause Stealth (Opt-in)**: Coerces \`WebView.onWindowVisibilityChanged\` to \`View.VISIBLE\`, blocks \`WebView.onPause()\` / \`pauseTimers()\`, and injects DOM stealth (\`document.hidden = false\`, \`document.visibilityState = "visible"\`, \`document.hasFocus = () => true\`, \`visibilitychange\`/\`blur\` suppression) without causing background Chromium GPU crashes on apps that don't need it.
   - **Lifecycle Suppression (Advanced Opt-in)**: Off by default to prevent \`SurfaceView\` / \`TextureView\` graphics stalls when resuming from Recents; optionally blocks \`onPause()\`, \`onStop()\`, \`Application.ActivityLifecycleCallbacks\`, and \`LifecycleRegistry\` (\`ON_PAUSE\`/\`ON_STOP\`).
   - **Modern UI & Environment Hooks**: Simulate zeroed pinned \`WindowInsets\` while keeping navigation usable, strip \`FLAG_SECURE\`, hide \`AccessibilityManager\` / overlay checks, and retain \`AudioManager\` focus across notifications.
4. **In-App Convenience & Morphe Patching**:
   - **Material 3 Expressive + Material You UI**: Includes one-tap **Light / Balanced / Aggressive** presets, per-app overrides with app icons, **JSON export/import**, and a **Live Hook Event Counter**.
   - **Morphe Patching (No Root / No Xposed)**: All controls are exposed directly as **Morphe Patching Options** inside \`${folderName}-v${ver}.mpp\` (universal patch, works on any APK).

## Practical Usage

${config.moduleName} lets you stay in control of multitasking and system navigation without breaking apps that insist on locking the screen or reacting aggressively to brief interruptions:

- **Keep Android Navigation & Recents Unlocked**: Stop apps from trapping your device in Screen Pinning so the Back button, Recents overview, gesture navigation, Quick Settings, and notifications always remain usable while the app believes pinning succeeded.
- **Multitask Without Focus-Loss Nagging or Resets**: Open Recents, switch briefly to a calculator/notes/translator app, pull down the notification shade, or open floating/split-screen windows without triggering focus-lost overlays, forced UI lockouts, WebView playback/timer pauses, or state resets.
- **No \`system_server\` Scoping Required**: Unlike legacy pinning hooks that hook the Android System Framework (\`android\`), ${config.moduleName} hooks purely inside the scoped target app process (or directly inside a Morphe-patched APK without root or LSPosed).
- **Per-App Presets & Patch-Time Granularity**: Start with the safe **Balanced** preset (\`Reactive\` mode + safe focus spoofing), or apply **Light** / **Aggressive** profiles, export/import per-app JSON configs, and enable advanced WebView/Insets/Lifecycle hooks only where needed.

## Option 1: Morphe Patching (No Root / No Xposed)

1. Download the \`${folderName}-morphe-patches\` artifact (\`${folderName}-v${ver}.mpp\`) built by \`.github/workflows/build-apk.yml\`, or build locally in \`morphe-patches/\`:
   \`\`\`bash
   gradle :patches:buildAndroid :patches:generatePatchesList
   \`\`\`
2. Import \`${folderName}-v${ver}.mpp\` into **Morphe Manager** (Expert Mode) or **Morphe Desktop CLI**.
3. Pick any target APK, enable the **${config.moduleName}** universal patch, and open **Patching Options** to configure:
   - \`Spoof Timing Mode\` (\`reactive\` default vs \`always\`)
   - \`Disable Pinning (startLockTask / stopLockTask)\` & \`Binder Stub$Proxy Interception\`
   - \`Spoof ActivityManager Pin State\` & \`Hide Multi-Window & Picture-in-Picture\`
   - \`Window Focus Spoofing (Safe)\` vs \`WebView Visibility, JS & Pause Stealth\` vs \`Suppress onPause / onStop (Advanced)\`
   - \`Simulate Pinned Window Insets\`, \`Strip FLAG_SECURE\`, \`Hide Accessibility & Overlay Checks\`, \`Retain Audio Focus\`
   - \`Spoof Settings.System lock_to_app_enabled\`, \`DevicePolicyManager.isLockTaskPermitted\`, and \`Verbose Logcat Debug Logging\`
4. Patch and install the modified APK.

## Option 2: LSPosed Setup

1. Install \`${folderName}-v${ver}.apk\` (from \`${folderName}-apks\`).
2. Open **LSPosed Manager** -> **Modules** -> **${config.moduleName}**.
3. Enable the module and select **only the target apps** you want to affect (keep **System Framework (\`android\`) UNCHECKED**).
4. Open the **${config.moduleName}** app to pick a preset (**Light**, **Balanced**, **Aggressive**), export/import JSON profiles, view the **Live Hook Event Counter**, or customize per-app toggles, then force-stop and relaunch your target app.

Package ID: \`${pkg}\`
Entry Class: \`${pkg}.PinSpoofModule\`

## Disclaimer

This project was created with the assistance of Artificial Intelligence. This software is provided **"as-is"**, without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and non-infringement. Should you encounter any issues or have suggestions for improvements, you are free to fork this repository and implement your own ideas. Use it responsibly and solely on devices and software where you are authorized to do so.
`;
}

export function generateProjectFiles(config: ModuleConfig): GeneratedFile[] {
  const pkg = sanitizePackageName(config.packageName);
  const pkgPath = pkg.replace(/\./g, '/');
  const scopes = parseScopes(config.recommendedScopes);

  const files: GeneratedFile[] = [
    {
      id: 'morphe-patch-kt',
      path: `morphe-patches/patches/src/main/kotlin/${pkgPath}/patches/PinSpoofPatch.kt`,
      label: 'PinSpoofPatch.kt (Morphe)',
      language: 'kotlin',
      content: generateMorphePatchKt(config, pkg),
    },
    {
      id: 'morphe-hooks-java',
      path: `morphe-patches/extensions/extension/src/main/java/${pkgPath}/extension/PinSpoofHooks.java`,
      label: 'PinSpoofHooks.java (Morphe)',
      language: 'kotlin',
      content: generateMorpheHooksJava(config, pkg),
    },
    {
      id: 'morphe-patches-gradle',
      path: 'morphe-patches/patches/build.gradle.kts',
      label: 'morphe-patches/patches.kts',
      language: 'gradle',
      content: generateMorphePatchesBuildGradle(config, pkg),
    },
    {
      id: 'morphe-settings-gradle',
      path: 'morphe-patches/settings.gradle.kts',
      label: 'morphe-patches/settings.kts',
      language: 'gradle',
      content: generateMorpheSettingsGradle(),
    },
    {
      id: 'morphe-root-gradle',
      path: 'morphe-patches/build.gradle.kts',
      label: 'morphe-patches/build.gradle.kts',
      language: 'gradle',
      content: generateMorpheRootBuildGradle(config),
    },
    {
      id: 'morphe-gradle-props',
      path: 'morphe-patches/gradle.properties',
      label: 'morphe-patches/gradle.properties',
      language: 'properties',
      content: generateMorpheGradleProperties(config),
    },
    {
      id: 'morphe-libs-toml',
      path: 'morphe-patches/gradle/libs.versions.toml',
      label: 'morphe-patches/libs.versions.toml',
      language: 'properties',
      content: generateMorpheLibsVersionsToml(),
    },
    {
      id: 'morphe-wrapper-props',
      path: 'morphe-patches/gradle/wrapper/gradle-wrapper.properties',
      label: 'morphe-patches/gradle-wrapper.properties',
      language: 'properties',
      content: generateMorpheWrapperProperties(),
    },
    {
      id: 'morphe-ext-gradle',
      path: 'morphe-patches/extensions/extension/build.gradle.kts',
      label: 'morphe-patches/extension.kts',
      language: 'gradle',
      content: generateMorpheExtensionBuildGradle(pkg),
    },
    {
      id: 'morphe-ext-manifest',
      path: 'morphe-patches/extensions/extension/src/main/AndroidManifest.xml',
      label: 'morphe-patches/extension Manifest',
      language: 'xml',
      content: generateMorpheExtensionManifest(),
    },
    {
      id: 'morphe-patchlist-kt',
      path: 'morphe-patches/patches/src/main/kotlin/util/PatchListGenerator.kt',
      label: 'PatchListGenerator.kt',
      language: 'kotlin',
      content: generateMorphePatchListGeneratorKt(),
    },
    {
      id: 'module-kt',
      path: `app/src/main/kotlin/${pkgPath}/PinSpoofModule.kt`,
      label: 'PinSpoofModule.kt',
      language: 'kotlin',
      content: generatePinSpoofModuleKt(config, pkg),
    },
    {
      id: 'config-kt',
      path: `app/src/main/kotlin/${pkgPath}/HookConfig.kt`,
      label: 'HookConfig.kt',
      language: 'kotlin',
      content: generateHookConfigKt(config, pkg),
    },
  ];

  if (config.includeMaterialYouUi) {
    files.push(
      {
        id: 'main-activity-kt',
        path: `app/src/main/kotlin/${pkgPath}/MainActivity.kt`,
        label: 'MainActivity.kt',
        language: 'kotlin',
        content: generateMainActivityKt(config, pkg),
      },
      {
        id: 'stats-receiver-kt',
        path: `app/src/main/kotlin/${pkgPath}/PinSpoofStatsReceiver.kt`,
        label: 'PinSpoofStatsReceiver.kt',
        language: 'kotlin',
        content: generateStatsReceiverKt(pkg),
      },
      {
        id: 'theme-kt',
        path: `app/src/main/kotlin/${pkgPath}/ui/PinSpoofTheme.kt`,
        label: 'PinSpoofTheme.kt',
        language: 'kotlin',
        content: generatePinSpoofThemeKt(pkg),
      },
      {
        id: 'prefs-kt',
        path: `app/src/main/kotlin/${pkgPath}/prefs/PrefsManager.kt`,
        label: 'PrefsManager.kt',
        language: 'kotlin',
        content: generatePrefsManagerKt(pkg),
      }
    );
  }

  files.push(
    {
      id: 'xposed-init',
      path: 'app/src/main/assets/xposed_init',
      label: 'xposed_init',
      language: 'text',
      content: `${pkg}.PinSpoofModule\n`,
    },
    {
      id: 'manifest',
      path: 'app/src/main/AndroidManifest.xml',
      label: 'AndroidManifest.xml',
      language: 'xml',
      content: generateAndroidManifest(config, pkg, scopes),
    },
    {
      id: 'app-gradle',
      path: 'app/build.gradle.kts',
      label: 'app/build.gradle.kts',
      language: 'gradle',
      content: generateAppBuildGradle(config, pkg),
    },
    {
      id: 'settings-gradle',
      path: 'settings.gradle.kts',
      label: 'settings.gradle.kts',
      language: 'gradle',
      content: generateSettingsGradle(config),
    },
    {
      id: 'root-gradle',
      path: 'build.gradle.kts',
      label: 'build.gradle.kts',
      language: 'gradle',
      content: generateRootBuildGradle(config),
    },
    {
      id: 'wrapper-props',
      path: 'gradle/wrapper/gradle-wrapper.properties',
      label: 'gradle-wrapper.properties',
      language: 'properties',
      content: generateGradleWrapperProperties(),
    },
    {
      id: 'gh-workflow',
      path: '.github/workflows/build-apk.yml',
      label: 'build-apk.yml',
      language: 'yaml',
      content: generateGithubWorkflow(config),
    },
    {
      id: 'strings-xml',
      path: 'app/src/main/res/values/strings.xml',
      label: 'strings.xml',
      language: 'xml',
      content: generateStringsXml(config),
    },
    {
      id: 'arrays-xml',
      path: 'app/src/main/res/values/arrays.xml',
      label: 'arrays.xml',
      language: 'xml',
      content: generateArraysXml(scopes),
    },
    {
      id: 'proguard',
      path: 'app/proguard-rules.pro',
      label: 'proguard-rules.pro',
      language: 'text',
      content: generateProguardRules(pkg),
    },
    {
      id: 'gradle-props',
      path: 'gradle.properties',
      label: 'gradle.properties',
      language: 'properties',
      content: generateGradleProperties(),
    },
    {
      id: 'readme',
      path: 'README.md',
      label: 'README.md',
      language: 'markdown',
      content: generateReadme(config, pkg),
    }
  );

  return files;
}

export async function downloadProjectZip(config: ModuleConfig): Promise<void> {
  const zip = new JSZip();
  const folderName = config.moduleName.trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'PinSpoof';

  const files = generateProjectFiles(config);
  for (const file of files) {
    zip.file(file.path, file.content);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${folderName}-v${config.versionName}-xposed-morphe.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
