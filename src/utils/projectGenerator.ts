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
  const escapedSigHex = config.spoofSignatureHex.replace(/["\\]/g, '').trim();
  return `package ${pkg}

/**
 * Compile-time default hook configuration generated for ${config.moduleName} v${config.versionName}.
 * When the Material You settings UI is enabled, runtime overrides from
 * XSharedPreferences take precedence per-app or globally.
 * Never requires scoping to system_server ("android").
 */
object HookConfig {
    const val MODULE_TAG = "${config.moduleName}"
    const val VERSION_NAME = "${config.versionName}"
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
    const val CLOAK_PACKAGES_INSTALLER = ${config.cloakPackagesAndInstaller}
    const val SANITIZE_STACK_TRACES = ${config.sanitizeStackTraces}
    const val SPOOF_MOTION_SENSORS = ${config.spoofMotionSensors}
    const val BYPASS_VIRTUAL_DISPLAYS = ${config.bypassVirtualDisplays}
    const val UNBLOCK_CLIPBOARD = ${config.unblockClipboard}
    const val SPOOF_PACKAGE_SIGNATURE = ${config.spoofPackageSignature}
    const val SPOOF_SIGNATURE_HEX = "${escapedSigHex}"
    const val SOFT_FAIL_INTEGRITY = ${config.softFailIntegrityChecks}
    const val DEBUG_LOGGING = ${config.debugLogging}
}
`;
}

function generateStatsReceiverKt(pkg: string): string {
  return `package ${pkg}

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONArray
import org.json.JSONObject

class PinSpoofStatsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != HookConfig.STATS_ACTION) return
        val pkg = intent.getStringExtra("pkg")?.takeIf { it.isNotBlank() } ?: return
        val pinDelta = intent.getLongExtra("pin", 0L).coerceAtLeast(0L)
        val focusDelta = intent.getLongExtra("focus", 0L).coerceAtLeast(0L)
        val lifecycleDelta = intent.getLongExtra("lifecycle", 0L).coerceAtLeast(0L)
        val webviewDelta = intent.getLongExtra("webview", 0L).coerceAtLeast(0L)
        val cloakDelta = intent.getLongExtra("cloak", 0L).coerceAtLeast(0L)
        val eventsRaw = intent.getStringExtra("events").orEmpty()
        if (pinDelta + focusDelta + lifecycleDelta + webviewDelta + cloakDelta == 0L && eventsRaw.isBlank()) {
            return
        }

        val prefs = context.getSharedPreferences(HookConfig.STATS_PREFS_NAME, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()

        val existingLog = runCatching {
            JSONArray(prefs.getString("events_log", "[]") ?: "[]")
        }.getOrElse { JSONArray() }

        val merged = mutableListOf<JSONObject>()
        for (i in 0 until existingLog.length()) {
            existingLog.optJSONObject(i)?.let { merged.add(it) }
        }

        if (eventsRaw.isNotBlank()) {
            eventsRaw.split(";").forEach { token ->
                val parts = token.split("|")
                if (parts.size >= 3) {
                    val cat = parts[0].trim()
                    val method = parts[1].trim()
                    val delta = parts[2].toLongOrNull() ?: 1L
                    if (cat.isNotEmpty() && method.isNotEmpty() && delta > 0L) {
                        val existingIdx = merged.indexOfFirst {
                            it.optString("pkg") == pkg &&
                                it.optString("category") == cat &&
                                it.optString("method") == method
                        }
                        if (existingIdx >= 0) {
                            val prev = merged.removeAt(existingIdx)
                            prev.put("count", prev.optLong("count", 0L) + delta)
                            prev.put("ts", now)
                            merged.add(0, prev)
                        } else {
                            merged.add(
                                0,
                                JSONObject().apply {
                                    put("pkg", pkg)
                                    put("category", cat)
                                    put("method", method)
                                    put("count", delta)
                                    put("ts", now)
                                }
                            )
                        }
                    }
                }
            }
        }

        val capped = JSONArray()
        merged.take(80).forEach { capped.put(it) }

        prefs.edit()
            .putLong("\$pkg::pin", prefs.getLong("\$pkg::pin", 0L) + pinDelta)
            .putLong("\$pkg::focus", prefs.getLong("\$pkg::focus", 0L) + focusDelta)
            .putLong("\$pkg::lifecycle", prefs.getLong("\$pkg::lifecycle", 0L) + lifecycleDelta)
            .putLong("\$pkg::webview", prefs.getLong("\$pkg::webview", 0L) + webviewDelta)
            .putLong("\$pkg::cloak", prefs.getLong("\$pkg::cloak", 0L) + cloakDelta)
            .putLong("\$pkg::ts", now)
            .putLong("__all__::pin", prefs.getLong("__all__::pin", 0L) + pinDelta)
            .putLong("__all__::focus", prefs.getLong("__all__::focus", 0L) + focusDelta)
            .putLong("__all__::lifecycle", prefs.getLong("__all__::lifecycle", 0L) + lifecycleDelta)
            .putLong("__all__::webview", prefs.getLong("__all__::webview", 0L) + webviewDelta)
            .putLong("__all__::cloak", prefs.getLong("__all__::cloak", 0L) + cloakDelta)
            .putLong("__all__::ts", now)
            .putString("events_log", capped.toString())
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
import android.app.Dialog
import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentResolver
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.content.pm.Signature
import android.graphics.Insets
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.TriggerEventListener
import android.hardware.display.DisplayManager
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.provider.Settings
import android.view.Display
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
 * ${config.moduleName} v${config.versionName} — App-Scoped LockTask, Anti-Detection & UI Stealth Module (Android 7 – 16 / API 24 – 36)
 *
 * 1. Reactive mode + Window Focus, WebView visibility/JS stealth, and Activity/Fragment lifecycle
 *    stealth are ON by default; Binder Stub\$Proxy hooks, anti-detection cloaking, virtual display
 *    & clipboard bypass, sensor spoofing, signature spoof, and integrity soft-fail are opt-in.
 * 2. Dynamic method-name scanning for ActivityClient & Binder Stub\$Proxy with strict error guards.
 * 3. Throttled live event reporting (counts + method-level event log) to the PinSpoof UI.
 */
class PinSpoofModule : IXposedHookLoadPackage {

    private val spoofedPinned = AtomicBoolean(HookConfig.ALWAYS_SPOOF_PINNED)
    private val hookedActivityClasses = ConcurrentHashMap.newKeySet<String>()
    private val hookedWebViewClients = ConcurrentHashMap.newKeySet<String>()
    private val hookedReceivers = ConcurrentHashMap.newKeySet<String>()
    private val hookedAudioListeners = ConcurrentHashMap.newKeySet<String>()
    private val hookedSensorListeners = ConcurrentHashMap.newKeySet<String>()
    private val hookedDisplayListeners = ConcurrentHashMap.newKeySet<String>()
    private val lastPrefsCheckMs = AtomicLong(0L)

    private val appContextRef = AtomicReferenceContext()
    private val pendingPinEvents = AtomicLong(0L)
    private val pendingFocusEvents = AtomicLong(0L)
    private val pendingLifecycleEvents = AtomicLong(0L)
    private val pendingWebViewEvents = AtomicLong(0L)
    private val pendingCloakEvents = AtomicLong(0L)
    private val pendingMethodEvents = ConcurrentHashMap<String, AtomicLong>()
    private val lastFlushMs = AtomicLong(0L)
    private val flushScheduled = AtomicBoolean(false)

    private val inStackSanitize = object : ThreadLocal<Boolean>() {
        override fun initialValue(): Boolean = false
    }

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

    private fun activePrefs(): XSharedPreferences? {
        val xPrefs = prefs ?: return null
        val now = SystemClock.elapsedRealtime()
        val prev = lastPrefsCheckMs.get()
        if (now - prev >= 500L && lastPrefsCheckMs.compareAndSet(prev, now)) {
            if (xPrefs.hasFileChanged()) {
                xPrefs.reload()
            }
        }
        return xPrefs
    }

    private fun readBool(pkg: String, key: String, fallback: Boolean): Boolean {
        val xPrefs = activePrefs() ?: return fallback
        val hasAppOverride = xPrefs.getBoolean("\${pkg}::override", false)
        return if (hasAppOverride) {
            xPrefs.getBoolean("\${pkg}::\$key", fallback)
        } else {
            xPrefs.getBoolean("global::\$key", fallback)
        }
    }

    private fun readString(pkg: String, key: String, fallback: String): String {
        val xPrefs = activePrefs() ?: return fallback
        val hasAppOverride = xPrefs.getBoolean("\${pkg}::override", false)
        return if (hasAppOverride) {
            xPrefs.getString("\${pkg}::\$key", fallback) ?: fallback
        } else {
            xPrefs.getString("global::\$key", fallback) ?: fallback
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

    private fun shouldCloakPackages(pkg: String): Boolean =
        isModuleEnabled(pkg) && readBool(pkg, "cloak_packages_installer", HookConfig.CLOAK_PACKAGES_INSTALLER)

    private fun shouldSanitizeStackTraces(pkg: String): Boolean =
        isModuleEnabled(pkg) && readBool(pkg, "sanitize_stack_traces", HookConfig.SANITIZE_STACK_TRACES)

    private fun shouldSpoofSensors(pkg: String): Boolean =
        isModuleEnabled(pkg) && readBool(pkg, "spoof_motion_sensors", HookConfig.SPOOF_MOTION_SENSORS)

    private fun shouldBypassVirtualDisplays(pkg: String): Boolean =
        isModuleEnabled(pkg) && readBool(pkg, "bypass_virtual_displays", HookConfig.BYPASS_VIRTUAL_DISPLAYS)

    private fun shouldUnblockClipboard(pkg: String): Boolean =
        isModuleEnabled(pkg) && readBool(pkg, "unblock_clipboard", HookConfig.UNBLOCK_CLIPBOARD)

    private fun shouldSpoofSignature(pkg: String): Boolean =
        isModuleEnabled(pkg) && readBool(pkg, "spoof_package_signature", HookConfig.SPOOF_PACKAGE_SIGNATURE)

    private fun shouldSoftFailIntegrity(pkg: String): Boolean =
        isModuleEnabled(pkg) && readBool(pkg, "soft_fail_integrity", HookConfig.SOFT_FAIL_INTEGRITY)

    private fun recordStat(pkg: String, category: String, methodLabel: String) {
        when (category) {
            "pin" -> pendingPinEvents.incrementAndGet()
            "focus" -> pendingFocusEvents.incrementAndGet()
            "lifecycle" -> pendingLifecycleEvents.incrementAndGet()
            "webview" -> pendingWebViewEvents.incrementAndGet()
            "cloak" -> pendingCloakEvents.incrementAndGet()
        }
        val cleanMethod = methodLabel.replace("|", ".").replace(";", ",")
        val key = "\$category|\$cleanMethod"
        val counter = pendingMethodEvents[key] ?: run {
            val fresh = AtomicLong(0L)
            pendingMethodEvents.putIfAbsent(key, fresh) ?: fresh
        }
        counter.incrementAndGet()
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
        val cloak = pendingCloakEvents.getAndSet(0L)

        val sb = StringBuilder()
        val iter = pendingMethodEvents.entries.iterator()
        var entries = 0
        while (iter.hasNext() && entries < 16) {
            val (k, atomicCount) = iter.next()
            val delta = atomicCount.getAndSet(0L)
            if (delta > 0L) {
                if (sb.isNotEmpty()) sb.append(';')
                sb.append(k).append('|').append(delta)
                entries++
            }
        }

        if (pin + focus + lifecycle + webview + cloak == 0L && sb.isEmpty()) return
        lastFlushMs.set(SystemClock.elapsedRealtime())
        runCatching {
            val intent = Intent(HookConfig.STATS_ACTION).apply {
                setPackage(HookConfig.MODULE_PKG)
                putExtra("pkg", pkg)
                putExtra("pin", pin)
                putExtra("focus", focus)
                putExtra("lifecycle", lifecycle)
                putExtra("webview", webview)
                putExtra("cloak", cloak)
                putExtra("events", sb.toString())
            }
            context.sendBroadcast(intent)
        }
    }

    private fun markPinned(pkg: String, source: String) {
        spoofedPinned.set(true)
        recordStat(pkg, "pin", source)
        log(pkg, "Blocked real pinning via \$source; spoofed state = LOCK_TASK_MODE_PINNED (2)")
    }

    private fun markUnpinned(pkg: String, source: String) {
        if (!isAlwaysPinned(pkg)) {
            spoofedPinned.set(false)
            recordStat(pkg, "pin", source)
            log(pkg, "Intercepted unpin via \$source; spoofed state = LOCK_TASK_MODE_NONE (0)")
        } else {
            log(pkg, "Intercepted unpin via \$source; maintaining always_spoof_pinned = true")
        }
    }

    private fun log(pkg: String, message: String) {
        if (readBool(pkg, "debug_logging", HookConfig.DEBUG_LOGGING)) {
            XposedBridge.log("[\${HookConfig.MODULE_TAG}][\$pkg] \$message")
        }
    }

    override fun handleLoadPackage(lpparam: LoadPackageParam) {
        // Never attach to self or system_server even if misconfigured in manager scope
        if (lpparam.packageName == HookConfig.MODULE_PKG || lpparam.packageName == "android") {
            return
        }

        val pkg = lpparam.packageName
        if (!isModuleEnabled(pkg)) {
            log(pkg, "Module disabled for \$pkg via granular preferences")
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
        hookFocusLossSpoof(lpparam)
        hookWebViewStealth(lpparam)
        hookLifecycleStealth(lpparam)
        hookMultiWindowAndPip(lpparam)
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
        if (readBool(pkg, "cloak_packages_installer", HookConfig.CLOAK_PACKAGES_INSTALLER)) {
            hookPackageAndInstallerCloaking(lpparam)
        }
        if (readBool(pkg, "sanitize_stack_traces", HookConfig.SANITIZE_STACK_TRACES)) {
            hookStackTraceSanitization(pkg)
        }
        if (readBool(pkg, "spoof_motion_sensors", HookConfig.SPOOF_MOTION_SENSORS)) {
            hookSensorSpoofing(lpparam)
        }
        if (readBool(pkg, "bypass_virtual_displays", HookConfig.BYPASS_VIRTUAL_DISPLAYS)) {
            hookVirtualDisplayBypass(lpparam)
        }
        if (readBool(pkg, "unblock_clipboard", HookConfig.UNBLOCK_CLIPBOARD)) {
            hookClipboardBypass(lpparam)
        }
        if (readBool(pkg, "spoof_package_signature", HookConfig.SPOOF_PACKAGE_SIGNATURE)) {
            hookPackageSignatureSpoof(lpparam)
        }
        if (readBool(pkg, "soft_fail_integrity", HookConfig.SOFT_FAIL_INTEGRITY)) {
            hookIntegritySoftFail(lpparam)
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
                            recordStat(pkg, "pin", "ActivityManager.getLockTaskModeState()")
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
                            recordStat(pkg, "pin", "ActivityManager.isInLockTaskMode()")
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
        val activityClientClass = XposedHelpers.findClassIfExists(
            "android.app.ActivityClient",
            lpparam.classLoader
        ) ?: return
        hookDynamicLockTaskMethods(activityClientClass, pkg, "ActivityClient")
    }

    private fun hookBinderProxies(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        listOf(
            "android.app.IActivityTaskManager\\\$Stub\\\$Proxy" to "IActivityTaskManager",
            "android.app.IActivityManager\\\$Stub\\\$Proxy" to "IActivityManager"
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
                                            markPinned(pkg, "\$label.\$name()")
                                            param.result = defaultReturnFor(method.returnType)
                                        }
                                        name.startsWith("stopLockTask") -> {
                                            if (!isModuleEnabled(pkg)) return
                                            markUnpinned(pkg, "\$label.\$name()")
                                            param.result = defaultReturnFor(method.returnType)
                                        }
                                        name == "getLockTaskModeState" -> {
                                            if (shouldSpoofAsPinned(pkg)) {
                                                recordStat(pkg, "pin", "\$label.\$name()")
                                                param.result = ActivityManager.LOCK_TASK_MODE_PINNED
                                            }
                                        }
                                        name == "isInLockTaskMode" -> {
                                            if (shouldSpoofAsPinned(pkg)) {
                                                recordStat(pkg, "pin", "\$label.\$name()")
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
            log(pkg, "\$label dynamic lock-task hook error: \${it.message}")
        }
    }

    private fun defaultReturnFor(returnType: Class<*>): Any? = when (returnType) {
        Boolean::class.javaPrimitiveType, java.lang.Boolean::class.java -> true
        Int::class.javaPrimitiveType, java.lang.Integer::class.java -> 0
        else -> null
    }

    private fun hookFocusLossSpoof(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName

        runCatching {
            XposedHelpers.findAndHookMethod(
                View::class.java,
                "dispatchWindowFocusChanged",
                Boolean::class.javaPrimitiveType,
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldHideFocus(pkg) && param.args[0] == false) {
                            recordStat(pkg, "focus", "View.dispatchWindowFocusChanged(false)")
                            param.result = null
                        }
                    }
                }
            )
        }

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

        val decorViewClass = XposedHelpers.findClassIfExists(
            "com.android.internal.policy.DecorView",
            lpparam.classLoader
        )
        if (decorViewClass != null) {
            runCatching {
                XposedBridge.hookAllMethods(
                    decorViewClass,
                    "dispatchWindowFocusChanged",
                    object : XC_MethodHook() {
                        override fun beforeHookedMethod(param: MethodHookParam) {
                            if (shouldHideFocus(pkg) && param.args.isNotEmpty() && param.args[0] == false) {
                                recordStat(pkg, "focus", "DecorView.dispatchWindowFocusChanged(false)")
                                param.result = null
                            }
                        }
                    }
                )
            }
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

        runCatching {
            XposedHelpers.findAndHookMethod(
                Activity::class.java,
                "onWindowFocusChanged",
                Boolean::class.javaPrimitiveType,
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldHideFocus(pkg) && param.args[0] == false) {
                            recordStat(pkg, "focus", "Activity.onWindowFocusChanged(false)")
                            param.result = null
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
                            recordStat(pkg, "focus", "Activity.hasWindowFocus()")
                            param.result = true
                        }
                    }
                }
            )
        }

        runCatching {
            XposedHelpers.findAndHookMethod(
                Dialog::class.java,
                "onWindowFocusChanged",
                Boolean::class.javaPrimitiveType,
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldHideFocus(pkg) && param.args[0] == false) {
                            recordStat(pkg, "focus", "Dialog.onWindowFocusChanged(false)")
                            param.result = null
                        }
                    }
                }
            )
        }

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

        runCatching {
            XposedBridge.hookAllMethods(
                Activity::class.java,
                "performTopResumedActivityChanged",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldHideFocus(pkg) && param.args.isNotEmpty() && param.args[0] == false) {
                            recordStat(pkg, "focus", "Activity.onTopResumedActivityChanged(false)")
                            log(pkg, "Suppressed performTopResumedActivityChanged(false)")
                            param.result = null
                        }
                    }
                }
            )
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                XposedHelpers.findAndHookMethod(
                    Activity::class.java,
                    "onTopResumedActivityChanged",
                    Boolean::class.javaPrimitiveType,
                    object : XC_MethodHook() {
                        override fun beforeHookedMethod(param: MethodHookParam) {
                            if (shouldHideFocus(pkg) && param.args[0] == false) {
                                recordStat(pkg, "focus", "Activity.onTopResumedActivityChanged(false)")
                                param.result = null
                            }
                        }
                    }
                )
            }
        }

        runCatching {
            XposedBridge.hookAllMethods(
                Activity::class.java,
                "performUserLeaving",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldHideFocus(pkg)) {
                            recordStat(pkg, "focus", "Activity.onUserLeaveHint()")
                            log(pkg, "Suppressed Activity.performUserLeaving() safely")
                            param.result = null
                        }
                    }
                }
            )
            XposedHelpers.findAndHookMethod(
                Activity::class.java,
                "onUserLeaveHint",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldHideFocus(pkg) || shouldHideLifecycle(pkg)) {
                            recordStat(pkg, "focus", "Activity.onUserLeaveHint()")
                            param.result = null
                        }
                    }
                }
            )
        }

        runCatching {
            XposedHelpers.findAndHookMethod(
                ActivityManager::class.java,
                "getMyMemoryState",
                ActivityManager.RunningAppProcessInfo::class.java,
                object : XC_MethodHook() {
                    override fun afterHookedMethod(param: MethodHookParam) {
                        if (!shouldHideFocus(pkg)) return
                        val outInfo = param.args[0] as? ActivityManager.RunningAppProcessInfo ?: return
                        if (outInfo.importance != ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND) {
                            recordStat(pkg, "focus", "ActivityManager.getMyMemoryState()")
                        }
                        outInfo.importance = ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
                    }
                }
            )
            XposedHelpers.findAndHookMethod(
                ActivityManager::class.java,
                "getRunningAppProcesses",
                object : XC_MethodHook() {
                    override fun afterHookedMethod(param: MethodHookParam) {
                        if (!shouldHideFocus(pkg)) return
                        val list = param.result as? List<*> ?: return
                        val myPid = Process.myPid()
                        var updated = false
                        for (item in list) {
                            val info = item as? ActivityManager.RunningAppProcessInfo ?: continue
                            if (info.pid == myPid || info.processName == pkg || info.pkgList?.contains(pkg) == true) {
                                if (info.importance != ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND) {
                                    info.importance = ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
                                    info.importanceReasonCode = ActivityManager.RunningAppProcessInfo.REASON_UNKNOWN
                                    updated = true
                                }
                            }
                        }
                        if (updated) {
                            recordStat(pkg, "focus", "ActivityManager.getRunningAppProcesses()")
                        }
                    }
                }
            )
        }

        val hookReceiverArg: (Any?) -> Unit = { candidate ->
            if (candidate is BroadcastReceiver) {
                val cls = candidate.javaClass
                if (hookedReceivers.add(cls.name)) {
                    runCatching {
                        XposedHelpers.findAndHookMethod(
                            cls,
                            "onReceive",
                            Context::class.java,
                            Intent::class.java,
                            object : XC_MethodHook() {
                                override fun beforeHookedMethod(p: MethodHookParam) {
                                    if (!shouldHideFocus(pkg)) return
                                    val intent = p.args.getOrNull(1) as? Intent ?: return
                                    if (intent.action == Intent.ACTION_CLOSE_SYSTEM_DIALOGS) {
                                        recordStat(pkg, "focus", "BroadcastReceiver(CLOSE_SYSTEM_DIALOGS)")
                                        log(pkg, "Suppressed ACTION_CLOSE_SYSTEM_DIALOGS on \${cls.simpleName}")
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
                ContextWrapper::class.java,
                "registerReceiver",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        param.args.forEach(hookReceiverArg)
                    }
                }
            )
            XposedHelpers.findClassIfExists("android.app.ContextImpl", lpparam.classLoader)?.let { ctxImpl ->
                listOf("registerReceiver", "registerReceiverInternal").forEach { mName ->
                    XposedBridge.hookAllMethods(
                        ctxImpl,
                        mName,
                        object : XC_MethodHook() {
                            override fun beforeHookedMethod(param: MethodHookParam) {
                                param.args.forEach(hookReceiverArg)
                            }
                        }
                    )
                }
            }
        }
    }

    private fun hookWebViewStealth(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        val webViewClass = XposedHelpers.findClassIfExists(
            "android.webkit.WebView",
            lpparam.classLoader
        ) ?: return

        runCatching {
            XposedBridge.hookAllMethods(
                webViewClass,
                "onWindowVisibilityChanged",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldHideWebView(pkg) && param.args.isNotEmpty() && param.args[0] != View.VISIBLE) {
                            recordStat(pkg, "webview", "WebView.onWindowVisibilityChanged()")
                            param.args[0] = View.VISIBLE
                        }
                    }
                }
            )
            XposedBridge.hookAllMethods(
                webViewClass,
                "dispatchWindowVisibilityChanged",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldHideWebView(pkg) && param.args.isNotEmpty() && param.args[0] != View.VISIBLE) {
                            param.args[0] = View.VISIBLE
                        }
                    }
                }
            )
            XposedHelpers.findAndHookMethod(
                webViewClass,
                "getWindowVisibility",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldHideWebView(pkg)) {
                            param.result = View.VISIBLE
                        }
                    }
                }
            )
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                XposedBridge.hookAllMethods(
                    webViewClass,
                    "onVisibilityAggregated",
                    object : XC_MethodHook() {
                        override fun beforeHookedMethod(param: MethodHookParam) {
                            if (shouldHideWebView(pkg) && param.args.isNotEmpty() && param.args[0] == false) {
                                recordStat(pkg, "webview", "WebView.onVisibilityAggregated(false)")
                                param.args[0] = true
                            }
                        }
                    }
                )
            }
            XposedBridge.hookAllMethods(
                webViewClass,
                "onWindowFocusChanged",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if ((shouldHideFocus(pkg) || shouldHideWebView(pkg)) &&
                            param.args.isNotEmpty() &&
                            param.args[0] == false
                        ) {
                            recordStat(pkg, "webview", "WebView.onWindowFocusChanged(false)")
                            param.result = null
                        }
                    }
                }
            )
        }

        runCatching {
            XposedBridge.hookAllMethods(
                webViewClass,
                "onPause",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldHideWebView(pkg)) {
                            recordStat(pkg, "webview", "WebView.onPause()")
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
                            recordStat(pkg, "webview", "WebView.pauseTimers()")
                            log(pkg, "Suppressed WebView.pauseTimers()")
                            param.result = null
                        }
                    }
                }
            )
        }

        val hookWebViewClientCallbacks = { targetClass: Class<*> ->
            listOf("onPageStarted", "onPageFinished").forEach { cbName ->
                runCatching {
                    XposedBridge.hookAllMethods(
                        targetClass,
                        cbName,
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

        hookWebViewClientCallbacks(WebViewClient::class.java)

        runCatching {
            XposedBridge.hookAllMethods(
                webViewClass,
                "setWebViewClient",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        val client = param.args.firstOrNull() as? WebViewClient ?: return
                        val clsName = client.javaClass.name
                        if (hookedWebViewClients.add(clsName)) {
                            hookWebViewClientCallbacks(client.javaClass)
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
                    recordStat(pkg, "webview", "WebView.evaluateJavascript(stealth)")
                }
            }
        }
    }

    private fun hookLifecycleStealth(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName

        runCatching {
            XposedBridge.hookAllMethods(
                Application::class.java,
                "dispatchActivityPaused",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        val act = param.args.firstOrNull() as? Activity
                        if (shouldHideLifecycle(pkg) && act?.isFinishing != true) {
                            recordStat(pkg, "lifecycle", "Application.dispatchActivityPaused()")
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
                            recordStat(pkg, "lifecycle", "Application.dispatchActivityStopped()")
                            param.result = null
                        }
                    }
                }
            )
        }

        listOf("androidx.fragment.app.Fragment", "android.app.Fragment").forEach { fragClassName ->
            val fragClass = XposedHelpers.findClassIfExists(fragClassName, lpparam.classLoader)
            if (fragClass != null) {
                listOf("onPause", "onStop").forEach { mName ->
                    runCatching {
                        XposedHelpers.findAndHookMethod(
                            fragClass,
                            mName,
                            object : XC_MethodHook() {
                                override fun beforeHookedMethod(param: MethodHookParam) {
                                    if (!shouldHideLifecycle(pkg)) return
                                    val act = runCatching {
                                        XposedHelpers.callMethod(param.thisObject, "getActivity") as? Activity
                                    }.getOrNull()
                                    if (act?.isFinishing != true) {
                                        runCatching { XposedHelpers.setBooleanField(param.thisObject, "mCalled", true) }
                                        recordStat(pkg, "lifecycle", "Fragment.\$mName()")
                                        param.result = null
                                    }
                                }
                            }
                        )
                    }
                }
            }
        }

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
                                recordStat(pkg, "lifecycle", "LifecycleRegistry(\$eventName)")
                                log(pkg, "Suppressed LifecycleRegistry.handleLifecycleEvent(\$eventName)")
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
                val simpleName = cls.simpleName
                runCatching {
                    val onPause = cls.getDeclaredMethod("onPause")
                    XposedBridge.hookMethod(onPause, object : XC_MethodHook() {
                        override fun beforeHookedMethod(param: MethodHookParam) {
                            val act = param.thisObject as? Activity ?: return
                            if (shouldHideLifecycle(pkg) && !act.isFinishing) {
                                XposedHelpers.setBooleanField(act, "mCalled", true)
                                recordStat(pkg, "lifecycle", "\$simpleName.onPause()")
                                log(pkg, "Suppressed \$name.onPause()")
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
                                recordStat(pkg, "lifecycle", "\$simpleName.onStop()")
                                log(pkg, "Suppressed \$name.onStop()")
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
                                recordStat(pkg, "focus", "\$simpleName.onUserLeaveHint()")
                                log(pkg, "Suppressed \$name.onUserLeaveHint()")
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
                                recordStat(pkg, "focus", "\$simpleName.onWindowFocusChanged(false)")
                                log(pkg, "Suppressed \$name.onWindowFocusChanged(false)")
                                param.result = null
                            }
                        }
                    })
                }
                runCatching {
                    val onTopResumed = cls.getDeclaredMethod(
                        "onTopResumedActivityChanged",
                        Boolean::class.javaPrimitiveType
                    )
                    XposedBridge.hookMethod(onTopResumed, object : XC_MethodHook() {
                        override fun beforeHookedMethod(param: MethodHookParam) {
                            if ((shouldHideFocus(pkg) || shouldHideLifecycle(pkg)) && param.args[0] == false) {
                                recordStat(pkg, "focus", "\$simpleName.onTopResumedActivityChanged(false)")
                                log(pkg, "Suppressed \$name.onTopResumedActivityChanged(false)")
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
                                recordStat(pkg, "focus", "Activity.isInMultiWindowMode()")
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
                                recordStat(pkg, "focus", "Activity.isInPictureInPictureMode()")
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
                                recordStat(pkg, "cloak", "WindowInsets.getInsets()")
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
                                recordStat(pkg, "cloak", "WindowInsets.isVisible()")
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
                                recordStat(pkg, "cloak", "WindowInsets.\$methodName()")
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
                            recordStat(pkg, "cloak", "Window.setFlags(FLAG_SECURE)")
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
                            recordStat(pkg, "cloak", "SurfaceView.setSecure()")
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
                            recordStat(pkg, "cloak", "AccessibilityManager.getEnabledList()")
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
                            recordStat(pkg, "cloak", "Settings.canDrawOverlays()")
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
                                        recordStat(pkg, "focus", "OnAudioFocusChange(\$change)")
                                        log(pkg, "Suppressed audio focus loss (\$change) on \${cls.simpleName}")
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
                "android.media.AudioFocusRequest\\\$Builder",
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

    private fun hookPackageAndInstallerCloaking(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        val appPmClass = XposedHelpers.findClassIfExists(
            "android.app.ApplicationPackageManager",
            lpparam.classLoader
        ) ?: return

        runCatching {
            @Suppress("DEPRECATION")
            XposedBridge.hookAllMethods(
                appPmClass,
                "getInstallerPackageName",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (!shouldCloakPackages(pkg)) return
                        val queried = param.args.firstOrNull() as? String
                        if (queried == pkg) {
                            param.result = "com.android.vending"
                            recordStat(pkg, "cloak", "PackageManager.getInstallerPackageName()")
                        }
                    }
                }
            )
            XposedBridge.hookAllMethods(
                appPmClass,
                "getInstalledPackages",
                object : XC_MethodHook() {
                    override fun afterHookedMethod(param: MethodHookParam) {
                        if (!shouldCloakPackages(pkg)) return
                        val list = (param.result as? List<*>) ?: return
                        val filtered = list.filter { item ->
                            val p = (item as? PackageInfo)?.packageName
                            p == null || p !in CLOAKED_PACKAGES
                        }
                        if (filtered.size != list.size) {
                            param.result = filtered
                            recordStat(pkg, "cloak", "PackageManager.getInstalledPackages()")
                        }
                    }
                }
            )
            XposedBridge.hookAllMethods(
                appPmClass,
                "getInstalledApplications",
                object : XC_MethodHook() {
                    override fun afterHookedMethod(param: MethodHookParam) {
                        if (!shouldCloakPackages(pkg)) return
                        val list = (param.result as? List<*>) ?: return
                        val filtered = list.filter { item ->
                            val p = (item as? ApplicationInfo)?.packageName
                            p == null || p !in CLOAKED_PACKAGES
                        }
                        if (filtered.size != list.size) {
                            param.result = filtered
                            recordStat(pkg, "cloak", "PackageManager.getInstalledApplications()")
                        }
                    }
                }
            )
            XposedBridge.hookAllMethods(
                appPmClass,
                "queryIntentActivities",
                object : XC_MethodHook() {
                    override fun afterHookedMethod(param: MethodHookParam) {
                        if (!shouldCloakPackages(pkg)) return
                        val list = (param.result as? List<*>) ?: return
                        val filtered = list.filter { item ->
                            val p = (item as? ResolveInfo)?.activityInfo?.packageName
                            p == null || p !in CLOAKED_PACKAGES
                        }
                        if (filtered.size != list.size) {
                            param.result = filtered
                            recordStat(pkg, "cloak", "PackageManager.queryIntentActivities()")
                        }
                    }
                }
            )
            XposedBridge.hookAllMethods(
                appPmClass,
                "getPackageInfo",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (!shouldCloakPackages(pkg)) return
                        val queried = param.args.firstOrNull() as? String ?: return
                        if (queried in CLOAKED_PACKAGES) {
                            recordStat(pkg, "cloak", "PackageManager.getPackageInfo(hidden)")
                            param.throwable = PackageManager.NameNotFoundException(queried)
                        }
                    }
                }
            )
        }
    }

    private fun hookStackTraceSanitization(pkg: String) {
        val filterFrames = { frames: Array<StackTraceElement>? ->
            if (frames == null) null
            else frames.filter { el ->
                val cls = el.className
                STACK_FILTER_MARKERS.none { marker -> cls.contains(marker, ignoreCase = true) }
            }.toTypedArray()
        }

        runCatching {
            XposedHelpers.findAndHookMethod(
                Thread::class.java,
                "getStackTrace",
                object : XC_MethodHook() {
                    override fun afterHookedMethod(param: MethodHookParam) {
                        if (!shouldSanitizeStackTraces(pkg) || inStackSanitize.get() == true) return
                        inStackSanitize.set(true)
                        try {
                            @Suppress("UNCHECKED_CAST")
                            val raw = param.result as? Array<StackTraceElement> ?: return
                            val clean = filterFrames(raw) ?: return
                            if (clean.size != raw.size) {
                                param.result = clean
                                recordStat(pkg, "cloak", "Thread.getStackTrace()")
                            }
                        } finally {
                            inStackSanitize.set(false)
                        }
                    }
                }
            )
            XposedHelpers.findAndHookMethod(
                Throwable::class.java,
                "getStackTrace",
                object : XC_MethodHook() {
                    override fun afterHookedMethod(param: MethodHookParam) {
                        if (!shouldSanitizeStackTraces(pkg) || inStackSanitize.get() == true) return
                        inStackSanitize.set(true)
                        try {
                            @Suppress("UNCHECKED_CAST")
                            val raw = param.result as? Array<StackTraceElement> ?: return
                            val clean = filterFrames(raw) ?: return
                            if (clean.size != raw.size) {
                                param.result = clean
                                recordStat(pkg, "cloak", "Throwable.getStackTrace()")
                            }
                        } finally {
                            inStackSanitize.set(false)
                        }
                    }
                }
            )
        }
    }

    private fun hookSensorSpoofing(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        runCatching {
            XposedBridge.hookAllMethods(
                SensorManager::class.java,
                "registerListener",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        val listener = param.args.firstOrNull { it is SensorEventListener } as? SensorEventListener
                            ?: return
                        val cls = listener.javaClass
                        if (hookedSensorListeners.add(cls.name)) {
                            runCatching {
                                XposedHelpers.findAndHookMethod(
                                    cls,
                                    "onSensorChanged",
                                    SensorEvent::class.java,
                                    object : XC_MethodHook() {
                                        override fun beforeHookedMethod(p: MethodHookParam) {
                                            if (!shouldSpoofSensors(pkg)) return
                                            val ev = p.args.firstOrNull() as? SensorEvent ?: return
                                            val values = ev.values ?: return
                                            when (ev.sensor?.type) {
                                                Sensor.TYPE_ACCELEROMETER, Sensor.TYPE_GRAVITY -> {
                                                    if (values.size >= 3) {
                                                        values[0] = 0f
                                                        values[1] = 0f
                                                        values[2] = SensorManager.GRAVITY_EARTH
                                                        recordStat(pkg, "cloak", "Sensor.Accelerometer")
                                                    }
                                                }
                                                Sensor.TYPE_GYROSCOPE, Sensor.TYPE_LINEAR_ACCELERATION -> {
                                                    if (values.size >= 3) {
                                                        values[0] = 0f
                                                        values[1] = 0f
                                                        values[2] = 0f
                                                        recordStat(pkg, "cloak", "Sensor.Gyroscope")
                                                    }
                                                }
                                            }
                                        }
                                    }
                                )
                            }
                        }
                    }
                }
            )
            XposedHelpers.findAndHookMethod(
                SensorManager::class.java,
                "requestTriggerSensor",
                TriggerEventListener::class.java,
                Sensor::class.java,
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (!shouldSpoofSensors(pkg)) return
                        val sensor = param.args[1] as? Sensor ?: return
                        if (sensor.type == Sensor.TYPE_SIGNIFICANT_MOTION) {
                            recordStat(pkg, "cloak", "Sensor.SignificantMotion")
                            param.result = false
                        }
                    }
                }
            )
        }
    }

    private fun hookVirtualDisplayBypass(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        runCatching {
            XposedBridge.hookAllMethods(
                DisplayManager::class.java,
                "getDisplays",
                object : XC_MethodHook() {
                    override fun afterHookedMethod(param: MethodHookParam) {
                        if (!shouldBypassVirtualDisplays(pkg)) return
                        @Suppress("UNCHECKED_CAST")
                        val displays = param.result as? Array<Display> ?: return
                        if (displays.size > 1) {
                            val primary = displays.firstOrNull { it.displayId == Display.DEFAULT_DISPLAY }
                                ?: displays.first()
                            param.result = arrayOf(primary)
                            recordStat(pkg, "cloak", "DisplayManager.getDisplays()")
                        }
                    }
                }
            )
            XposedHelpers.findAndHookMethod(
                DisplayManager::class.java,
                "getDisplay",
                Int::class.javaPrimitiveType,
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (!shouldBypassVirtualDisplays(pkg)) return
                        val id = param.args[0] as? Int ?: return
                        if (id != Display.DEFAULT_DISPLAY) {
                            recordStat(pkg, "cloak", "DisplayManager.getDisplay(\$id)")
                            param.result = null
                        }
                    }
                }
            )
            XposedBridge.hookAllMethods(
                DisplayManager::class.java,
                "registerDisplayListener",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        val listener = param.args.firstOrNull { it is DisplayManager.DisplayListener }
                            as? DisplayManager.DisplayListener ?: return
                        val cls = listener.javaClass
                        if (hookedDisplayListeners.add(cls.name)) {
                            listOf("onDisplayAdded", "onDisplayChanged", "onDisplayRemoved").forEach { mName ->
                                runCatching {
                                    XposedHelpers.findAndHookMethod(
                                        cls,
                                        mName,
                                        Int::class.javaPrimitiveType,
                                        object : XC_MethodHook() {
                                            override fun beforeHookedMethod(p: MethodHookParam) {
                                                if (!shouldBypassVirtualDisplays(pkg)) return
                                                val id = p.args[0] as? Int ?: return
                                                if (id != Display.DEFAULT_DISPLAY) {
                                                    recordStat(pkg, "cloak", "DisplayListener.\$mName()")
                                                    p.result = null
                                                }
                                            }
                                        }
                                    )
                                }
                            }
                        }
                    }
                }
            )
        }
    }

    private fun hookClipboardBypass(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                XposedHelpers.findAndHookMethod(
                    ClipboardManager::class.java,
                    "clearPrimaryClip",
                    object : XC_MethodHook() {
                        override fun beforeHookedMethod(param: MethodHookParam) {
                            if (shouldUnblockClipboard(pkg)) {
                                recordStat(pkg, "cloak", "ClipboardManager.clearPrimaryClip()")
                                log(pkg, "Blocked ClipboardManager.clearPrimaryClip()")
                                param.result = null
                            }
                        }
                    }
                )
            }
            XposedHelpers.findAndHookMethod(
                ClipboardManager::class.java,
                "setPrimaryClip",
                ClipData::class.java,
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (!shouldUnblockClipboard(pkg)) return
                        val clip = param.args[0] as? ClipData
                        val isEmptyClear = clip == null ||
                            clip.itemCount == 0 ||
                            (clip.itemCount == 1 && clip.getItemAt(0)?.text?.isBlank() == true)
                        if (isEmptyClear) {
                            recordStat(pkg, "cloak", "ClipboardManager.setPrimaryClip(empty)")
                            log(pkg, "Blocked blank ClipboardManager.setPrimaryClip() wipe")
                            param.result = null
                        }
                    }
                }
            )
        }
    }

    private fun hookPackageSignatureSpoof(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        val buildSpoofSig = {
            val hex = readString(pkg, "spoof_signature_hex", HookConfig.SPOOF_SIGNATURE_HEX)
                .replace(":", "")
                .replace(" ", "")
                .trim()
            if (hex.isNotEmpty() && hex.length >= 128) {
                runCatching { Signature(hex) }.getOrNull()
            } else {
                null
            }
        }

        val appPmClass = XposedHelpers.findClassIfExists(
            "android.app.ApplicationPackageManager",
            lpparam.classLoader
        )
        if (appPmClass != null) {
            runCatching {
                @Suppress("DEPRECATION")
                XposedBridge.hookAllMethods(
                    appPmClass,
                    "getPackageInfo",
                    object : XC_MethodHook() {
                        override fun afterHookedMethod(param: MethodHookParam) {
                            if (!shouldSpoofSignature(pkg)) return
                            val queriedPkg = param.args.firstOrNull() as? String ?: return
                            if (queriedPkg != pkg) return
                            val info = param.result as? PackageInfo ?: return
                            val sig = buildSpoofSig() ?: return
                            info.signatures = arrayOf(sig)
                            recordStat(pkg, "cloak", "PackageInfo.signatures")
                        }
                    }
                )
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val signingInfoClass = XposedHelpers.findClassIfExists(
                "android.content.pm.SigningInfo",
                lpparam.classLoader
            )
            if (signingInfoClass != null) {
                runCatching {
                    listOf("getApkContentsSigners", "getSigningCertificateHistory").forEach { mName ->
                        XposedBridge.hookAllMethods(
                            signingInfoClass,
                            mName,
                            object : XC_MethodHook() {
                                override fun afterHookedMethod(param: MethodHookParam) {
                                    if (!shouldSpoofSignature(pkg)) return
                                    val sig = buildSpoofSig() ?: return
                                    param.result = arrayOf(sig)
                                    recordStat(pkg, "cloak", "SigningInfo.\$mName()")
                                }
                            }
                        )
                    }
                }
            }
        }
    }

    private fun hookIntegritySoftFail(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        val taskClass = XposedHelpers.findClassIfExists(
            "com.google.android.gms.tasks.Task",
            lpparam.classLoader
        )
        if (taskClass != null) {
            runCatching {
                XposedBridge.hookAllMethods(
                    taskClass,
                    "getException",
                    object : XC_MethodHook() {
                        override fun afterHookedMethod(param: MethodHookParam) {
                            if (!shouldSoftFailIntegrity(pkg)) return
                            val ex = param.result as? Throwable ?: return
                            val msg = "\${ex.javaClass.name} \${ex.message}"
                            if (msg.contains("Integrity", ignoreCase = true) ||
                                msg.contains("SafetyNet", ignoreCase = true) ||
                                msg.contains("attest", ignoreCase = true)
                            ) {
                                recordStat(pkg, "cloak", "PlayIntegrity.softFail")
                                param.result = null
                            }
                        }
                    }
                )
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
                            recordStat(pkg, "pin", "Settings.System.lock_to_app")
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
                            recordStat(pkg, "pin", "DevicePolicyManager.isLockTaskPermitted()")
                            log(pkg, "DevicePolicyManager.isLockTaskPermitted(\$pkg) -> true")
                        }
                    }
                }
            )
        }.onFailure {
            log(pkg, "DevicePolicyManager hook skipped: \${it.message}")
        }
    }

    companion object {
        private val CLOAKED_PACKAGES = setOf(
            "de.robv.android.xposed.installer",
            "org.lsposed.manager",
            "io.github.lsposed.manager",
            "app.morphe.manager",
            "com.topjohnwu.magisk",
            "us.redcatx.pinspoof"
        )

        private val STACK_FILTER_MARKERS = listOf(
            "de.robv.android.xposed",
            "LSPHooker",
            "EdHooker",
            "me.weishu.epic",
            "us.redcatx.pinspoof"
        )

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
                  if ((e.type === 'blur' || e.type === 'focusout') && e.target !== window && e.target !== document) return;
                  e.stopImmediatePropagation();
                };
                window.addEventListener('blur', stopFocusEvent, true);
                window.addEventListener('focusout', stopFocusEvent, true);
                window.addEventListener('pagehide', stopFocusEvent, true);
                document.addEventListener('blur', stopFocusEvent, true);
                document.addEventListener('focusout', stopFocusEvent, true);
                document.addEventListener('visibilitychange', stopFocusEvent, true);
                document.addEventListener('webkitvisibilitychange', stopFocusEvent, true);
                document.addEventListener('freeze', stopFocusEvent, true);
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
import org.json.JSONArray
import org.json.JSONObject
import ${pkg}.HookConfig

enum class HookPreset(val label: String, val summary: String) {
    LIGHT("Light", "Pinning bypass & state spoof only"),
    BALANCED("Balanced", "Default stealth: pinning + focus + WebView + lifecycle"),
    AGGRESSIVE("Aggressive", "All stealth, anti-detection, display & UI hooks")
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
    val cloakPackagesInstaller: Boolean = HookConfig.CLOAK_PACKAGES_INSTALLER,
    val sanitizeStackTraces: Boolean = HookConfig.SANITIZE_STACK_TRACES,
    val spoofMotionSensors: Boolean = HookConfig.SPOOF_MOTION_SENSORS,
    val bypassVirtualDisplays: Boolean = HookConfig.BYPASS_VIRTUAL_DISPLAYS,
    val unblockClipboard: Boolean = HookConfig.UNBLOCK_CLIPBOARD,
    val spoofPackageSignature: Boolean = HookConfig.SPOOF_PACKAGE_SIGNATURE,
    val spoofSignatureHex: String = HookConfig.SPOOF_SIGNATURE_HEX,
    val softFailIntegrity: Boolean = HookConfig.SOFT_FAIL_INTEGRITY,
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
            cloakPackagesInstaller = false,
            sanitizeStackTraces = false,
            spoofMotionSensors = false,
            bypassVirtualDisplays = false,
            unblockClipboard = false,
            spoofPackageSignature = false,
            softFailIntegrity = false,
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
            hideWebViewVisibility = true,
            hideLifecycleLoss = true,
            hideMultiWindowPip = true,
            spoofPinnedInsets = false,
            stripFlagSecure = false,
            hideAccessibilityOverlays = false,
            retainAudioFocus = false,
            cloakPackagesInstaller = false,
            sanitizeStackTraces = false,
            spoofMotionSensors = false,
            bypassVirtualDisplays = false,
            unblockClipboard = false,
            spoofPackageSignature = false,
            softFailIntegrity = false,
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
            cloakPackagesInstaller = true,
            sanitizeStackTraces = true,
            spoofMotionSensors = true,
            bypassVirtualDisplays = true,
            unblockClipboard = true,
            spoofPackageSignature = true,
            softFailIntegrity = true,
            hookActivityLockTask = true,
            hookActivityManagerState = true,
            hookBinderProxies = true,
            hookActivityClient = true,
            hookSettingsLockToApp = true,
            hookDpmPermitted = true
        )
    }

    fun matchingPreset(): HookPreset? =
        HookPreset.entries.firstOrNull { this == this.withPreset(it) }

    fun pruneUnusedHooks(loggedEntries: List<HookLogEntry>): Pair<GranularHookState, Int> {
        val activeMethods = loggedEntries
            .filter { it.count > 0L }
            .map { it.category to it.method }

        fun hasHit(predicate: (category: String, method: String) -> Boolean): Boolean =
            activeMethods.any { (c, m) -> predicate(c, m) }

        val next = copy(
            hideFocusLoss = hideFocusLoss && hasHit { c, m ->
                c == "focus" &&
                    !m.startsWith("OnAudioFocusChange") &&
                    !m.contains("MultiWindow") &&
                    !m.contains("PictureInPicture")
            },
            hideWebViewVisibility = hideWebViewVisibility && hasHit { c, _ -> c == "webview" },
            hideLifecycleLoss = hideLifecycleLoss && hasHit { c, _ -> c == "lifecycle" },
            hideMultiWindowPip = hideMultiWindowPip && hasHit { _, m ->
                m.contains("MultiWindow") || m.contains("PictureInPicture")
            },
            spoofPinnedInsets = spoofPinnedInsets && hasHit { _, m -> m.startsWith("WindowInsets.") },
            stripFlagSecure = stripFlagSecure && hasHit { _, m ->
                m.contains("FLAG_SECURE") || m.startsWith("SurfaceView.setSecure")
            },
            hideAccessibilityOverlays = hideAccessibilityOverlays && hasHit { _, m ->
                m.startsWith("AccessibilityManager.") || m.startsWith("Settings.canDrawOverlays")
            },
            retainAudioFocus = retainAudioFocus && hasHit { _, m -> m.startsWith("OnAudioFocusChange") },
            cloakPackagesInstaller = cloakPackagesInstaller && hasHit { _, m -> m.startsWith("PackageManager.") },
            sanitizeStackTraces = sanitizeStackTraces && hasHit { _, m -> m.endsWith(".getStackTrace()") },
            spoofMotionSensors = spoofMotionSensors && hasHit { _, m -> m.startsWith("Sensor.") },
            bypassVirtualDisplays = bypassVirtualDisplays && hasHit { _, m ->
                m.startsWith("DisplayManager.") || m.startsWith("DisplayListener.")
            },
            unblockClipboard = unblockClipboard && hasHit { _, m -> m.startsWith("ClipboardManager.") },
            spoofPackageSignature = spoofPackageSignature && hasHit { _, m ->
                m.startsWith("PackageInfo.signatures") || m.startsWith("SigningInfo.")
            },
            softFailIntegrity = softFailIntegrity && hasHit { _, m -> m.startsWith("PlayIntegrity.") },
            hookActivityLockTask = hookActivityLockTask && hasHit { c, m ->
                c == "pin" && m.startsWith("Activity.")
            },
            hookActivityManagerState = hookActivityManagerState && hasHit { c, m ->
                c == "pin" && m.startsWith("ActivityManager.")
            },
            hookActivityClient = hookActivityClient && hasHit { c, m ->
                c == "pin" && m.startsWith("ActivityClient.")
            },
            hookBinderProxies = hookBinderProxies && hasHit { c, m ->
                c == "pin" && (m.startsWith("IActivityTaskManager.") || m.startsWith("IActivityManager."))
            },
            hookSettingsLockToApp = hookSettingsLockToApp && hasHit { _, m -> m.startsWith("Settings.System.") },
            hookDpmPermitted = hookDpmPermitted && hasHit { _, m -> m.startsWith("DevicePolicyManager.") }
        )

        val disabledCount = listOf(
            hideFocusLoss to next.hideFocusLoss,
            hideWebViewVisibility to next.hideWebViewVisibility,
            hideLifecycleLoss to next.hideLifecycleLoss,
            hideMultiWindowPip to next.hideMultiWindowPip,
            spoofPinnedInsets to next.spoofPinnedInsets,
            stripFlagSecure to next.stripFlagSecure,
            hideAccessibilityOverlays to next.hideAccessibilityOverlays,
            retainAudioFocus to next.retainAudioFocus,
            cloakPackagesInstaller to next.cloakPackagesInstaller,
            sanitizeStackTraces to next.sanitizeStackTraces,
            spoofMotionSensors to next.spoofMotionSensors,
            bypassVirtualDisplays to next.bypassVirtualDisplays,
            unblockClipboard to next.unblockClipboard,
            spoofPackageSignature to next.spoofPackageSignature,
            softFailIntegrity to next.softFailIntegrity,
            hookActivityLockTask to next.hookActivityLockTask,
            hookActivityManagerState to next.hookActivityManagerState,
            hookActivityClient to next.hookActivityClient,
            hookBinderProxies to next.hookBinderProxies,
            hookSettingsLockToApp to next.hookSettingsLockToApp,
            hookDpmPermitted to next.hookDpmPermitted
        ).count { (before, after) -> before && !after }

        return next to disabledCount
    }

    fun toMorpheChecklist(): List<Pair<String, String>> = listOf(
        "Spoof Timing Mode" to if (alwaysSpoofPinned) {
            "Always Pinned (from launch)"
        } else {
            "Reactive (after startLockTask)"
        },
        "Disable Pinning (startLockTask / stopLockTask)" to
            if (masterEnabled && (hookActivityLockTask || hookActivityClient)) "ON" else "OFF",
        "Spoof ActivityManager Pin State" to
            if (masterEnabled && hookActivityManagerState) "ON" else "OFF",
        "Binder Stub\\\$Proxy LockTask Interception (Advanced)" to
            if (masterEnabled && hookBinderProxies) "ON" else "OFF",
        "Window Focus Spoofing (Safe)" to
            if (masterEnabled && hideFocusLoss) "ON" else "OFF",
        "WebView Visibility, JS & Pause Stealth" to
            if (masterEnabled && hideWebViewVisibility) "ON" else "OFF",
        "Suppress onPause / onStop" to
            if (masterEnabled && hideLifecycleLoss) "ON" else "OFF",
        "Hide Multi-Window & Picture-in-Picture" to
            if (masterEnabled && hideMultiWindowPip) "ON" else "OFF",
        "Simulate Pinned Window Insets" to
            if (masterEnabled && spoofPinnedInsets) "ON" else "OFF",
        "Strip FLAG_SECURE" to
            if (masterEnabled && stripFlagSecure) "ON" else "OFF",
        "Virtual Display & Screen Sharing Bypass" to
            if (masterEnabled && bypassVirtualDisplays) "ON" else "OFF",
        "Unblock Clipboard Clear" to
            if (masterEnabled && unblockClipboard) "ON" else "OFF",
        "Hide Accessibility & Overlay Checks" to
            if (masterEnabled && hideAccessibilityOverlays) "ON" else "OFF",
        "Retain Audio Focus" to
            if (masterEnabled && retainAudioFocus) "ON" else "OFF",
        "Cloak Packages & Play Store Installer" to
            if (masterEnabled && cloakPackagesInstaller) "ON" else "OFF",
        "Sanitize Stack Traces" to
            if (masterEnabled && sanitizeStackTraces) "ON" else "OFF",
        "Spoof Motion Sensors (Stationary)" to
            if (masterEnabled && spoofMotionSensors) "ON" else "OFF",
        "Static Package Signature Spoof" to
            if (masterEnabled && spoofPackageSignature) "ON" else "OFF",
        "Original Certificate DER Hex" to
            spoofSignatureHex.trim().ifEmpty { "(empty)" },
        "Play Integrity / SafetyNet Soft-Fail" to
            if (masterEnabled && softFailIntegrity) "ON" else "OFF",
        "Spoof Settings.System lock_to_app_enabled" to
            if (masterEnabled && hookSettingsLockToApp) "ON" else "OFF",
        "Spoof DevicePolicyManager.isLockTaskPermitted" to
            if (masterEnabled && hookDpmPermitted) "ON" else "OFF",
        "Verbose Logcat Debug Logging" to
            if (debugLogging) "ON" else "OFF"
    )

    fun toJson(targetPackage: String?): String = JSONObject().apply {
        put("schemaVersion", 3)
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
        put("cloakPackagesInstaller", cloakPackagesInstaller)
        put("sanitizeStackTraces", sanitizeStackTraces)
        put("spoofMotionSensors", spoofMotionSensors)
        put("bypassVirtualDisplays", bypassVirtualDisplays)
        put("unblockClipboard", unblockClipboard)
        put("spoofPackageSignature", spoofPackageSignature)
        put("spoofSignatureHex", spoofSignatureHex)
        put("softFailIntegrity", softFailIntegrity)
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
                cloakPackagesInstaller = obj.optBoolean("cloakPackagesInstaller", base.cloakPackagesInstaller),
                sanitizeStackTraces = obj.optBoolean("sanitizeStackTraces", base.sanitizeStackTraces),
                spoofMotionSensors = obj.optBoolean("spoofMotionSensors", base.spoofMotionSensors),
                bypassVirtualDisplays = obj.optBoolean("bypassVirtualDisplays", base.bypassVirtualDisplays),
                unblockClipboard = obj.optBoolean("unblockClipboard", base.unblockClipboard),
                spoofPackageSignature = obj.optBoolean("spoofPackageSignature", base.spoofPackageSignature),
                spoofSignatureHex = obj.optString("spoofSignatureHex", base.spoofSignatureHex),
                softFailIntegrity = obj.optBoolean("softFailIntegrity", base.softFailIntegrity),
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
    val cloakBypassed: Long = 0L,
    val lastUpdatedMs: Long = 0L
) {
    val total: Long get() = pinBlocked + focusHidden + lifecycleHidden + webviewSpoofed + cloakBypassed
}

data class HookLogEntry(
    val pkg: String,
    val category: String,
    val method: String,
    val count: Long,
    val timestampMs: Long
)

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
            "\$targetPackage::"
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
            cloakPackagesInstaller = prefs.getBoolean(
                "\${prefix}cloak_packages_installer",
                g?.cloakPackagesInstaller ?: HookConfig.CLOAK_PACKAGES_INSTALLER
            ),
            sanitizeStackTraces = prefs.getBoolean(
                "\${prefix}sanitize_stack_traces",
                g?.sanitizeStackTraces ?: HookConfig.SANITIZE_STACK_TRACES
            ),
            spoofMotionSensors = prefs.getBoolean(
                "\${prefix}spoof_motion_sensors",
                g?.spoofMotionSensors ?: HookConfig.SPOOF_MOTION_SENSORS
            ),
            bypassVirtualDisplays = prefs.getBoolean(
                "\${prefix}bypass_virtual_displays",
                g?.bypassVirtualDisplays ?: HookConfig.BYPASS_VIRTUAL_DISPLAYS
            ),
            unblockClipboard = prefs.getBoolean(
                "\${prefix}unblock_clipboard",
                g?.unblockClipboard ?: HookConfig.UNBLOCK_CLIPBOARD
            ),
            spoofPackageSignature = prefs.getBoolean(
                "\${prefix}spoof_package_signature",
                g?.spoofPackageSignature ?: HookConfig.SPOOF_PACKAGE_SIGNATURE
            ),
            spoofSignatureHex = prefs.getString(
                "\${prefix}spoof_signature_hex",
                g?.spoofSignatureHex ?: HookConfig.SPOOF_SIGNATURE_HEX
            ) ?: HookConfig.SPOOF_SIGNATURE_HEX,
            softFailIntegrity = prefs.getBoolean(
                "\${prefix}soft_fail_integrity",
                g?.softFailIntegrity ?: HookConfig.SOFT_FAIL_INTEGRITY
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
        val prefix = if (targetPackage != null) "\$targetPackage::" else "global::"
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
            putBoolean("\${prefix}cloak_packages_installer", state.cloakPackagesInstaller)
            putBoolean("\${prefix}sanitize_stack_traces", state.sanitizeStackTraces)
            putBoolean("\${prefix}spoof_motion_sensors", state.spoofMotionSensors)
            putBoolean("\${prefix}bypass_virtual_displays", state.bypassVirtualDisplays)
            putBoolean("\${prefix}unblock_clipboard", state.unblockClipboard)
            putBoolean("\${prefix}spoof_package_signature", state.spoofPackageSignature)
            putString("\${prefix}spoof_signature_hex", state.spoofSignatureHex.trim())
            putBoolean("\${prefix}soft_fail_integrity", state.softFailIntegrity)
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
            pinBlocked = statsPrefs.getLong("\$key::pin", 0L),
            focusHidden = statsPrefs.getLong("\$key::focus", 0L),
            lifecycleHidden = statsPrefs.getLong("\$key::lifecycle", 0L),
            webviewSpoofed = statsPrefs.getLong("\$key::webview", 0L),
            cloakBypassed = statsPrefs.getLong("\$key::cloak", 0L),
            lastUpdatedMs = statsPrefs.getLong("\$key::ts", 0L)
        )
    }

    fun getPackageHitTotal(packageName: String): Long =
        statsPrefs.getLong("\$packageName::pin", 0L) +
            statsPrefs.getLong("\$packageName::focus", 0L) +
            statsPrefs.getLong("\$packageName::lifecycle", 0L) +
            statsPrefs.getLong("\$packageName::webview", 0L) +
            statsPrefs.getLong("\$packageName::cloak", 0L)

    fun loadEventLog(targetPackage: String?): List<HookLogEntry> {
        val raw = statsPrefs.getString("events_log", "[]") ?: "[]"
        val arr = runCatching { JSONArray(raw) }.getOrElse { return emptyList() }
        val result = mutableListOf<HookLogEntry>()
        for (i in 0 until arr.length()) {
            val obj = arr.optJSONObject(i) ?: continue
            val pkg = obj.optString("pkg")
            if (targetPackage != null && pkg != targetPackage) continue
            result.add(
                HookLogEntry(
                    pkg = pkg,
                    category = obj.optString("category"),
                    method = obj.optString("method"),
                    count = obj.optLong("count", 0L),
                    timestampMs = obj.optLong("ts", 0L)
                )
            )
        }
        return result
    }

    fun resetStats(targetPackage: String?) {
        statsPrefs.edit().apply {
            if (targetPackage == null) {
                clear()
            } else {
                remove("\$targetPackage::pin")
                remove("\$targetPackage::focus")
                remove("\$targetPackage::lifecycle")
                remove("\$targetPackage::webview")
                remove("\$targetPackage::cloak")
                remove("\$targetPackage::ts")
                val filtered = JSONArray()
                val arr = runCatching {
                    JSONArray(statsPrefs.getString("events_log", "[]") ?: "[]")
                }.getOrElse { JSONArray() }
                for (i in 0 until arr.length()) {
                    val obj = arr.optJSONObject(i) ?: continue
                    if (obj.optString("pkg") != targetPackage) {
                        filtered.put(obj)
                    }
                }
                putString("events_log", filtered.toString())
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

import android.content.Intent
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
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AccessibilityNew
import androidx.compose.material.icons.rounded.Analytics
import androidx.compose.material.icons.rounded.Android
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.AspectRatio
import androidx.compose.material.icons.rounded.AutoFixHigh
import androidx.compose.material.icons.rounded.Cast
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Checklist
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Code
import androidx.compose.material.icons.rounded.ContentPaste
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Fingerprint
import androidx.compose.material.icons.rounded.Language
import androidx.compose.material.icons.rounded.LayersClear
import androidx.compose.material.icons.rounded.PauseCircleOutline
import androidx.compose.material.icons.rounded.PhonelinkLock
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.ScreenRotation
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material.icons.rounded.Upload
import androidx.compose.material.icons.rounded.VerifiedUser
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material.icons.rounded.VolumeUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
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
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import ${pkg}.prefs.GranularHookState
import ${pkg}.prefs.HookLogEntry
import ${pkg}.prefs.HookPreset
import ${pkg}.prefs.HookStats
import ${pkg}.prefs.PrefsManager
import ${pkg}.ui.PinSpoofTheme

data class InstalledAppItem(
    val label: String,
    val packageName: String,
    val hasOverride: Boolean,
    val hitTotal: Long
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

@OptIn(
    ExperimentalMaterial3Api::class,
    ExperimentalMaterial3ExpressiveApi::class,
    ExperimentalLayoutApi::class
)
@Composable
private fun PinSpoofControlScreen(prefsManager: PrefsManager) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
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
    var eventLog by remember(selectedPkg) { mutableStateOf(prefsManager.loadEventLog(selectedPkg)) }
    var showAppPicker by remember { mutableStateOf(false) }
    var showEventLogSheet by remember { mutableStateOf(false) }
    var eventLogFilter by remember { mutableStateOf("all") }
    var morpheOptionsTarget by remember { mutableStateOf<Pair<String, GranularHookState>?>(null) }

    DisposableEffect(prefsManager, selectedPkg, lifecycleOwner) {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ ->
            stats = prefsManager.loadStats(selectedPkg)
            eventLog = prefsManager.loadEventLog(selectedPkg)
        }
        val lifecycleObserver = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                stats = prefsManager.loadStats(selectedPkg)
                eventLog = prefsManager.loadEventLog(selectedPkg)
            }
        }
        prefsManager.registerStatsListener(listener)
        lifecycleOwner.lifecycle.addObserver(lifecycleObserver)
        onDispose {
            prefsManager.unregisterStatsListener(listener)
            lifecycleOwner.lifecycle.removeObserver(lifecycleObserver)
        }
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
                            text = HookConfig.MODULE_TAG,
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
            // Material You Cohesive Scope Selector Card + JSON Export/Import
            item {
                ElevatedCard(
                    shape = RoundedCornerShape(28.dp),
                    colors = CardDefaults.elevatedCardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceContainerLow
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
                                        .background(MaterialTheme.colorScheme.secondaryContainer),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(
                                        imageVector = Icons.Rounded.Apps,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.onSecondaryContainer
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
                                shape = RoundedCornerShape(16.dp),
                                colors = ButtonDefaults.filledTonalButtonColors(
                                    containerColor = MaterialTheme.colorScheme.secondaryContainer,
                                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer
                                )
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
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            OutlinedButton(
                                onClick = {
                                    val base = selectedPkg ?: "global"
                                    exportLauncher.launch("pinspoof-\$base.json")
                                },
                                shape = RoundedCornerShape(16.dp),
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                                colors = ButtonDefaults.outlinedButtonColors(
                                    contentColor = MaterialTheme.colorScheme.onSurface
                                ),
                                contentPadding = PaddingValues(0.dp),
                                modifier = Modifier
                                    .weight(1f)
                                    .height(44.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.Upload,
                                    contentDescription = "Export JSON",
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                            OutlinedButton(
                                onClick = { importLauncher.launch(arrayOf("application/json", "text/plain")) },
                                shape = RoundedCornerShape(16.dp),
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                                colors = ButtonDefaults.outlinedButtonColors(
                                    contentColor = MaterialTheme.colorScheme.onSurface
                                ),
                                contentPadding = PaddingValues(0.dp),
                                modifier = Modifier
                                    .weight(1f)
                                    .height(44.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.Download,
                                    contentDescription = "Import JSON",
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                            OutlinedButton(
                                onClick = { morpheOptionsTarget = selectedLabel to hookState },
                                shape = RoundedCornerShape(16.dp),
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                                colors = ButtonDefaults.outlinedButtonColors(
                                    contentColor = MaterialTheme.colorScheme.onSurface
                                ),
                                contentPadding = PaddingValues(0.dp),
                                modifier = Modifier
                                    .weight(1f)
                                    .height(44.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.Checklist,
                                    contentDescription = "Morphe Patching Options",
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }

                        if (selectedPkg != null) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    text = "Custom rule saved for this app",
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

            // Live Hook Event Counter Card (tappable tiles open Live Hook Event Log drawer)
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
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.Analytics,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary
                            )
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = "Live Hook Event Counter",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Text(
                                    text = if (selectedPkg == null) {
                                        "Tap a tile for method log · \${stats.cloakBypassed} cloak"
                                    } else {
                                        "\$selectedLabel · Tap a tile for method log"
                                    },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                            IconButton(
                                onClick = {
                                    prefsManager.resetStats(selectedPkg)
                                    stats = HookStats()
                                    eventLog = prefsManager.loadEventLog(selectedPkg)
                                    scope.launch {
                                        snackbarHostState.showSnackbar("Reset event counters")
                                    }
                                }
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.Refresh,
                                    contentDescription = "Reset event counters",
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            StatTile(
                                label = "Pinning",
                                count = stats.pinBlocked,
                                onClick = {
                                    eventLogFilter = "pin"
                                    showEventLogSheet = true
                                },
                                modifier = Modifier.weight(1f)
                            )
                            StatTile(
                                label = "Focus",
                                count = stats.focusHidden,
                                onClick = {
                                    eventLogFilter = "focus"
                                    showEventLogSheet = true
                                },
                                modifier = Modifier.weight(1f)
                            )
                            StatTile(
                                label = "WebView",
                                count = stats.webviewSpoofed,
                                onClick = {
                                    eventLogFilter = "webview"
                                    showEventLogSheet = true
                                },
                                modifier = Modifier.weight(1f)
                            )
                            StatTile(
                                label = "Lifecycle",
                                count = stats.lifecycleHidden,
                                onClick = {
                                    eventLogFilter = "lifecycle"
                                    showEventLogSheet = true
                                },
                                modifier = Modifier.weight(1f)
                            )
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
                            subtitle = "Force View.VISIBLE, block WebView.onPause()/pauseTimers()/onVisibilityAggregated(false), and spoof JS visibility/blur",
                            checked = hookState.hideWebViewVisibility,
                            onCheckedChange = { v -> updateState { it.copy(hideWebViewVisibility = v) } }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.PauseCircleOutline,
                            title = "Suppress onPause / onStop",
                            subtitle = "Block Activity/Fragment/LifecycleRegistry transitions to hide Recents & switching (disable or use Light preset if a SurfaceView/game stalls)",
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

            // Expanded Display, Clipboard, Insets & Media Bypass Card
            item {
                ElevatedCard(shape = RoundedCornerShape(28.dp)) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Text(
                            text = "Display, Media & UI Bypass",
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
                            icon = Icons.Rounded.Cast,
                            title = "Virtual Display & Casting Bypass",
                            subtitle = "Expose only Display.DEFAULT_DISPLAY in DisplayManager and filter external display callbacks",
                            checked = hookState.bypassVirtualDisplays,
                            onCheckedChange = { v -> updateState { it.copy(bypassVirtualDisplays = v) } }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.ContentPaste,
                            title = "Unblock Clipboard Clear",
                            subtitle = "Suppress ClipboardManager.clearPrimaryClip() and blank clip wipes inside scoped apps",
                            checked = hookState.unblockClipboard,
                            onCheckedChange = { v -> updateState { it.copy(unblockClipboard = v) } }
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

            // Deeper Anti-Detection, Sensors, Signature & Integrity Cloaking Card
            item {
                ElevatedCard(shape = RoundedCornerShape(28.dp)) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Text(
                            text = "Anti-Detection & Integrity Cloaking",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold
                        )

                        ExpressiveToggleRow(
                            icon = Icons.Rounded.Security,
                            title = "Cloak Packages & Play Installer",
                            subtitle = "Report com.android.vending as installer and hide Xposed / LSPosed / Morphe packages",
                            checked = hookState.cloakPackagesInstaller,
                            onCheckedChange = { v -> updateState { it.copy(cloakPackagesInstaller = v) } }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.Code,
                            title = "Sanitize Stack Traces",
                            subtitle = "Strip Xposed, LSPHooker, EdHooker, and PinSpoof frames from Thread/Throwable stack traces",
                            checked = hookState.sanitizeStackTraces,
                            onCheckedChange = { v -> updateState { it.copy(sanitizeStackTraces = v) } }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.ScreenRotation,
                            title = "Spoof Motion Sensors (Stationary)",
                            subtitle = "Clamp accelerometer, gyroscope, and significant-motion sensors to resting desk readings",
                            checked = hookState.spoofMotionSensors,
                            onCheckedChange = { v -> updateState { it.copy(spoofMotionSensors = v) } }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.Fingerprint,
                            title = "Spoof Package Signature",
                            subtitle = "Return original signing certificate bytes on PackageInfo.signatures / SigningInfo queries",
                            checked = hookState.spoofPackageSignature,
                            onCheckedChange = { v -> updateState { it.copy(spoofPackageSignature = v) } }
                        )
                        AnimatedVisibility(visible = hookState.spoofPackageSignature) {
                            OutlinedTextField(
                                value = hookState.spoofSignatureHex,
                                onValueChange = { hex -> updateState { it.copy(spoofSignatureHex = hex) } },
                                label = { Text("Original Certificate DER Hex (optional)") },
                                placeholder = { Text("3082...") },
                                singleLine = true,
                                textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                                shape = RoundedCornerShape(16.dp),
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.VerifiedUser,
                            title = "Play Integrity / SafetyNet Soft-Fail",
                            subtitle = "Clear local Integrity / attestation Task exceptions to prevent hard client crashes",
                            checked = hookState.softFailIntegrity,
                            onCheckedChange = { v -> updateState { it.copy(softFailIntegrity = v) } }
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
                            title = "Binder Stub\\\$Proxy Interception (Advanced)",
                            subtitle = "OFF by default: dynamic Stub\\\$Proxy scan for apps calling Binder proxies directly",
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

    // Inline Expandable App Rules + Per-App Presets Sheet
    if (showAppPicker) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)
        val pickerListState = rememberLazyListState()
        val navBottomPadding = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
        var query by remember { mutableStateOf("") }
        var appFilter by remember { mutableStateOf("all") }
        var expandedPkg by remember { mutableStateOf<String?>(selectedPkg) }
        val appStatesMap = remember { mutableStateMapOf<String, GranularHookState>() }
        val overrideMap = remember { mutableStateMapOf<String, Boolean>() }

        val installedApps = remember {
            val pm = context.packageManager
            val launchablePkgs = runCatching {
                val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                pm.queryIntentActivities(intent, 0).mapNotNullTo(HashSet()) { it.activityInfo?.packageName }
            }.getOrDefault(emptySet())

            pm.getInstalledApplications(PackageManager.GET_META_DATA)
                .asSequence()
                .mapNotNull { info ->
                    val pName = info.packageName
                    if (pName == HookConfig.MODULE_PKG || pName == "android") return@mapNotNull null
                    val hasCustom = prefsManager.hasPerAppOverride(pName)
                    val hitTotal = prefsManager.getPackageHitTotal(pName)
                    val isUserOrLaunchable = (info.flags and ApplicationInfo.FLAG_SYSTEM) == 0 ||
                        pName in launchablePkgs ||
                        hasCustom ||
                        hitTotal > 0L
                    if (!isUserOrLaunchable) return@mapNotNull null
                    overrideMap[pName] = hasCustom
                    InstalledAppItem(
                        label = pm.getApplicationLabel(info).toString(),
                        packageName = pName,
                        hasOverride = hasCustom,
                        hitTotal = hitTotal
                    )
                }
                .sortedWith(compareBy<InstalledAppItem> { it.label.lowercase() }.thenBy { it.packageName })
                .toList()
        }

        val modifiedCount = remember(overrideMap.toMap()) {
            installedApps.count { overrideMap[it.packageName] == true }
        }
        val activeHitsCount = remember(installedApps) {
            installedApps.count { it.hitTotal > 0L }
        }

        val filtered = remember(query, appFilter, installedApps, overrideMap.toMap()) {
            installedApps.filter { app ->
                val matchesTab = when (appFilter) {
                    "modified" -> overrideMap[app.packageName] == true
                    "active" -> app.hitTotal > 0L
                    else -> true
                }
                if (!matchesTab) return@filter false
                if (query.isBlank()) true
                else app.label.contains(query, ignoreCase = true) ||
                    app.packageName.contains(query, ignoreCase = true)
            }
        }

        ModalBottomSheet(
            onDismissRequest = { showAppPicker = false },
            sheetState = sheetState
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Text(
                        text = "Select App for Granular Override",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = "Tap any app to expand inline presets and save individual rules",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
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
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        FilterChip(
                            selected = appFilter == "all",
                            onClick = { appFilter = "all" },
                            label = { Text("All (\${installedApps.size})") }
                        )
                        FilterChip(
                            selected = appFilter == "modified",
                            onClick = { appFilter = "modified" },
                            label = { Text("Modified (\$modifiedCount)") }
                        )
                        FilterChip(
                            selected = appFilter == "active",
                            onClick = { appFilter = "active" },
                            label = { Text("Active Hits (\$activeHitsCount)") }
                        )
                    }
                }

                Spacer(Modifier.height(10.dp))

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .layout { measurable, constraints ->
                            val offsetPx = runCatching { sheetState.requireOffset() }
                                .getOrNull()
                                ?.takeIf { !it.isNaN() }
                                ?.roundToInt()
                                ?.coerceAtLeast(0)
                                ?: 0
                            val visibleHeight = (constraints.maxHeight - offsetPx)
                                .coerceIn(0, constraints.maxHeight)
                            val placeable = measurable.measure(
                                constraints.copy(minHeight = 0, maxHeight = visibleHeight)
                            )
                            layout(constraints.maxWidth, constraints.maxHeight) {
                                placeable.place(0, 0)
                            }
                        }
                ) {
                    LazyColumn(
                        state = pickerListState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(
                            start = 20.dp,
                            end = 20.dp,
                            top = 4.dp,
                            bottom = 24.dp + navBottomPadding
                        ),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        items(filtered, key = { it.packageName }) { app ->
                        val isExpanded = expandedPkg == app.packageName
                        val isCustom = overrideMap[app.packageName] == true
                        val appState = appStatesMap.getOrPut(app.packageName) {
                            prefsManager.loadState(app.packageName)
                        }

                        fun saveAppRule(next: GranularHookState) {
                            appStatesMap[app.packageName] = next
                            overrideMap[app.packageName] = true
                            prefsManager.saveState(app.packageName, next)
                            if (selectedPkg == app.packageName) {
                                hookState = next
                                hasOverride = true
                            }
                        }

                        Surface(
                            onClick = {
                                expandedPkg = if (isExpanded) null else app.packageName
                            },
                            shape = RoundedCornerShape(20.dp),
                            color = if (isCustom) {
                                MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.72f)
                            } else {
                                MaterialTheme.colorScheme.surfaceContainerHigh
                            }
                        ) {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 14.dp)
                            ) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(12.dp)
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

                                    if (app.hitTotal > 0L) {
                                        Surface(
                                            shape = RoundedCornerShape(10.dp),
                                            color = MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.8f)
                                        ) {
                                            Text(
                                                text = "\${app.hitTotal} hits",
                                                style = MaterialTheme.typography.labelSmall,
                                                fontFamily = FontFamily.Monospace,
                                                color = MaterialTheme.colorScheme.onTertiaryContainer,
                                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                            )
                                        }
                                    }

                                    if (isCustom) {
                                        val presetTag = appState.matchingPreset()?.label ?: "Custom"
                                        Surface(
                                            shape = RoundedCornerShape(10.dp),
                                            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.16f)
                                        ) {
                                            Text(
                                                text = presetTag,
                                                style = MaterialTheme.typography.labelSmall,
                                                fontWeight = FontWeight.SemiBold,
                                                color = MaterialTheme.colorScheme.primary,
                                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                                            )
                                        }
                                    }

                                    Icon(
                                        imageVector = if (isExpanded) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore,
                                        contentDescription = if (isExpanded) "Collapse rules" else "Expand rules",
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }

                                AnimatedVisibility(visible = isExpanded) {
                                    Column(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(top = 14.dp),
                                        verticalArrangement = Arrangement.spacedBy(10.dp)
                                    ) {
                                        HorizontalDivider(
                                            color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f)
                                        )

                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.SpaceBetween
                                        ) {
                                            Column(modifier = Modifier.weight(1f)) {
                                                Text(
                                                    text = "Save Individual App Rule",
                                                    style = MaterialTheme.typography.bodyMedium,
                                                    fontWeight = FontWeight.Medium
                                                )
                                                Text(
                                                    text = if (isCustom) "Uses independent per-app profile" else "Currently inherits Global Defaults",
                                                    style = MaterialTheme.typography.bodySmall,
                                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                                )
                                            }
                                            ExpressiveSwitch(
                                                checked = isCustom,
                                                onCheckedChange = { enabled ->
                                                    overrideMap[app.packageName] = enabled
                                                    prefsManager.setPerAppOverride(app.packageName, enabled)
                                                    val reloaded = prefsManager.loadState(if (enabled) app.packageName else null)
                                                    appStatesMap[app.packageName] = reloaded
                                                    if (enabled) {
                                                        prefsManager.saveState(app.packageName, reloaded)
                                                    }
                                                    if (selectedPkg == app.packageName) {
                                                        hasOverride = enabled
                                                        hookState = reloaded
                                                    }
                                                }
                                            )
                                        }

                                        Text(
                                            text = "Per-App Preset Profile",
                                            style = MaterialTheme.typography.labelMedium,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                                            HookPreset.entries.forEachIndexed { idx, preset ->
                                                val presetSelected = isCustom && appState == appState.withPreset(preset)
                                                SegmentedButton(
                                                    selected = presetSelected,
                                                    onClick = { saveAppRule(appState.withPreset(preset)) },
                                                    shape = SegmentedButtonDefaults.itemShape(
                                                        index = idx,
                                                        count = HookPreset.entries.size
                                                    )
                                                ) {
                                                    Text(preset.label, maxLines = 1)
                                                }
                                            }
                                        }

                                        InlineAppRuleSwitch(
                                            title = "Disable Pinning & Spoof Pinned",
                                            checked = appState.masterEnabled,
                                            onCheckedChange = { v -> saveAppRule(appState.copy(masterEnabled = v)) }
                                        )
                                        InlineAppRuleSwitch(
                                            title = "Window Focus Spoofing (Safe)",
                                            checked = appState.hideFocusLoss,
                                            onCheckedChange = { v -> saveAppRule(appState.copy(hideFocusLoss = v)) }
                                        )
                                        InlineAppRuleSwitch(
                                            title = "WebView JS & Visibility Stealth",
                                            checked = appState.hideWebViewVisibility,
                                            onCheckedChange = { v -> saveAppRule(appState.copy(hideWebViewVisibility = v)) }
                                        )
                                        InlineAppRuleSwitch(
                                            title = "Suppress onPause / onStop",
                                            checked = appState.hideLifecycleLoss,
                                            onCheckedChange = { v -> saveAppRule(appState.copy(hideLifecycleLoss = v)) }
                                        )
                                        InlineAppRuleSwitch(
                                            title = "Strip FLAG_SECURE",
                                            checked = appState.stripFlagSecure,
                                            onCheckedChange = { v -> saveAppRule(appState.copy(stripFlagSecure = v)) }
                                        )
                                        InlineAppRuleSwitch(
                                            title = "Cloak Packages & Stack Traces",
                                            checked = appState.cloakPackagesInstaller || appState.sanitizeStackTraces,
                                            onCheckedChange = { v ->
                                                saveAppRule(
                                                    appState.copy(
                                                        cloakPackagesInstaller = v,
                                                        sanitizeStackTraces = v
                                                    )
                                                )
                                            }
                                        )

                                        OutlinedButton(
                                            onClick = { morpheOptionsTarget = app.label to appState },
                                            shape = RoundedCornerShape(14.dp),
                                            modifier = Modifier.fillMaxWidth()
                                        ) {
                                            Icon(Icons.Rounded.Checklist, null, modifier = Modifier.size(16.dp))
                                            Spacer(Modifier.size(8.dp))
                                            Text("Morphe Patching Options")
                                        }

                                        FilledTonalButton(
                                            onClick = {
                                                if (!isCustom) {
                                                    saveAppRule(appState)
                                                }
                                                selectedPkg = app.packageName
                                                selectedLabel = app.label
                                                hookState = prefsManager.loadState(app.packageName)
                                                hasOverride = true
                                                showAppPicker = false
                                            },
                                            shape = RoundedCornerShape(14.dp),
                                            modifier = Modifier.fillMaxWidth()
                                        ) {
                                            Text("Open All Controls & JSON")
                                        }
                                    }
                                }
                            }
                        }
                    }
                    }
                }
            }
        }
    }

    // Live Hook Event Log Drawer (opened by tapping any StatTile)
    if (showEventLogSheet) {
        val logSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)
        val logListState = rememberLazyListState()
        val navBottomPadding = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
        val filterChips = listOf(
            "all" to "All",
            "pin" to "Pinning",
            "focus" to "Focus",
            "webview" to "WebView",
            "lifecycle" to "Lifecycle",
            "cloak" to "Cloaking"
        )
        val filteredEntries = remember(eventLog, eventLogFilter) {
            if (eventLogFilter == "all") eventLog
            else eventLog.filter { it.category == eventLogFilter }
        }
        val timeFmt = remember { DateFormat.getTimeInstance(DateFormat.MEDIUM) }

        LaunchedEffect(eventLogFilter) {
            logListState.scrollToItem(0)
        }

        ModalBottomSheet(
            onDismissRequest = { showEventLogSheet = false },
            sheetState = logSheetState
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Live Hook Event Log",
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.SemiBold
                            )
                            Text(
                                text = selectedPkg ?: "All scoped apps",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        IconButton(
                            onClick = {
                                prefsManager.resetStats(selectedPkg)
                                stats = HookStats()
                                eventLog = prefsManager.loadEventLog(selectedPkg)
                            }
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.Refresh,
                                contentDescription = "Reset event log"
                            )
                        }
                    }

                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        filterChips.forEach { (id, label) ->
                            FilterChip(
                                selected = eventLogFilter == id,
                                onClick = { eventLogFilter = id },
                                label = { Text(label) }
                            )
                        }
                    }

                    FilledTonalButton(
                        onClick = {
                            if (eventLog.isEmpty()) {
                                scope.launch {
                                    snackbarHostState.showSnackbar("No recorded hits yet — launch the target app first")
                                }
                                return@FilledTonalButton
                            }
                            val (prunedState, disabledCount) = hookState.pruneUnusedHooks(eventLog)
                            updateState { prunedState }
                            scope.launch {
                                snackbarHostState.showSnackbar(
                                    if (disabledCount > 0) {
                                        "Kept active hooks for \$selectedLabel · disabled \$disabledCount unused"
                                    } else {
                                        "All enabled hooks already have active hits"
                                    }
                                )
                            }
                        },
                        enabled = eventLog.isNotEmpty(),
                        shape = RoundedCornerShape(14.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.AutoFixHigh,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(Modifier.size(8.dp))
                        Text("Keep Active Only (Prune 0-Hit Hooks)")
                    }
                }

                Spacer(Modifier.height(10.dp))

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .layout { measurable, constraints ->
                            val offsetPx = runCatching { logSheetState.requireOffset() }
                                .getOrNull()
                                ?.takeIf { !it.isNaN() }
                                ?.roundToInt()
                                ?.coerceAtLeast(0)
                                ?: 0
                            val visibleHeight = (constraints.maxHeight - offsetPx)
                                .coerceIn(0, constraints.maxHeight)
                            val placeable = measurable.measure(
                                constraints.copy(minHeight = 0, maxHeight = visibleHeight)
                            )
                            layout(constraints.maxWidth, constraints.maxHeight) {
                                placeable.place(0, 0)
                            }
                        }
                ) {
                    if (filteredEntries.isEmpty()) {
                        Surface(
                            shape = RoundedCornerShape(18.dp),
                            color = MaterialTheme.colorScheme.surfaceContainerHigh,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 20.dp)
                        ) {
                            Text(
                                text = "No hook events recorded for this filter yet. Launch a scoped target app and trigger pinning or focus transitions.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(16.dp)
                            )
                        }
                    } else {
                        LazyColumn(
                            state = logListState,
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(
                                start = 20.dp,
                                end = 20.dp,
                                top = 4.dp,
                                bottom = 24.dp + navBottomPadding
                            ),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            items(
                                items = filteredEntries,
                                key = { "\${it.pkg}|\${it.category}|\${it.method}" }
                            ) { entry ->
                                EventLogRow(entry = entry, formattedTime = timeFmt.format(Date(entry.timestampMs)))
                            }
                        }
                    }
                }
            }
        }
    }

    // Morphe Patching Options Checklist Dialog
    morpheOptionsTarget?.let { (targetTitle, targetState) ->
        val checklist = remember(targetState) { targetState.toMorpheChecklist() }

        AlertDialog(
            onDismissRequest = { morpheOptionsTarget = null },
            title = {
                Column {
                    Text("Morphe Patching Options", fontWeight = FontWeight.SemiBold)
                    Text(
                        text = targetTitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            },
            text = {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 420.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = if (targetState.masterEnabled) {
                            "Enable these toggles in Morphe Manager under PinSpoof Patching Options:"
                        } else {
                            "Master switch is OFF for this config — all hooks are shown OFF:"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    checklist.forEach { (optName, optValue) ->
                        val isActiveVal = optValue == "ON" || optValue.startsWith("Always")
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = optName,
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier
                                    .weight(1f)
                                    .padding(end = 8.dp)
                            )
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = if (isActiveVal) {
                                    MaterialTheme.colorScheme.primaryContainer
                                } else {
                                    MaterialTheme.colorScheme.surfaceContainerHighest
                                }
                            ) {
                                Text(
                                    text = optValue,
                                    style = MaterialTheme.typography.labelSmall,
                                    fontFamily = FontFamily.Monospace,
                                    color = if (isActiveVal) {
                                        MaterialTheme.colorScheme.onPrimaryContainer
                                    } else {
                                        MaterialTheme.colorScheme.onSurfaceVariant
                                    },
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                                )
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { morpheOptionsTarget = null }) {
                    Text("Close")
                }
            }
        )
    }
}

@Composable
private fun StatTile(
    label: String,
    count: Long,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                text = count.toString(),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace
            )
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1
            )
        }
    }
}

@Composable
private fun EventLogRow(entry: HookLogEntry, formattedTime: String) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    text = entry.method,
                    style = MaterialTheme.typography.bodyMedium,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = "\${entry.pkg} · \$formattedTime",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Surface(
                shape = RoundedCornerShape(10.dp),
                color = MaterialTheme.colorScheme.secondaryContainer
            ) {
                Text(
                    text = "×\${entry.count}",
                    style = MaterialTheme.typography.labelMedium,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                )
            }
        }
    }
}

@Composable
private fun InlineAppRuleSwitch(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.weight(1f)
        )
        ExpressiveSwitch(checked = checked, onCheckedChange = onCheckedChange)
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
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(
                    if (checked) MaterialTheme.colorScheme.secondaryContainer
                    else MaterialTheme.colorScheme.surfaceContainerHighest
                ),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = if (checked) MaterialTheme.colorScheme.onSecondaryContainer
                else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp)
            )
        }
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
  const ver = config.versionName.trim() || '1.4.0';
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
  const escapedSigHex = config.spoofSignatureHex.replace(/["\\]/g, '').trim();
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
    description = "Disables app pinning (LockTask), spoofs pinned state, and applies focus, WebView, display, clipboard, sensor, and anti-detection patches directly in APKs without root or Xposed.",
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
        title = "Binder Stub\\\$Proxy LockTask Interception (Advanced)",
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
        description = "Force WebView visibility VISIBLE, block WebView.onPause()/pauseTimers()/onVisibilityAggregated(false), and inject DOM visibility/blur stealth JS.",
    )

    val hideLifecycleLoss by booleanOption(
        key = "hideLifecycleLoss",
        default = ${config.hideLifecycleLoss},
        title = "Suppress onPause / onStop",
        description = "Block Activity/Fragment onPause(), onStop(), ActivityLifecycleCallbacks, and LifecycleRegistry transitions (disable if a SurfaceView/game stalls on resume).",
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

    val bypassVirtualDisplays by booleanOption(
        key = "bypassVirtualDisplays",
        default = ${config.bypassVirtualDisplays},
        title = "Virtual Display & Screen Sharing Bypass",
        description = "Expose only Display.DEFAULT_DISPLAY in DisplayManager and filter secondary display listener callbacks.",
    )

    val unblockClipboard by booleanOption(
        key = "unblockClipboard",
        default = ${config.unblockClipboard},
        title = "Unblock Clipboard Clear",
        description = "Prevent ClipboardManager.clearPrimaryClip() and empty clip wipes during copy/paste.",
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

    val cloakPackagesAndInstaller by booleanOption(
        key = "cloakPackagesAndInstaller",
        default = ${config.cloakPackagesAndInstaller},
        title = "Cloak Packages & Play Store Installer",
        description = "Report com.android.vending as installer and hide Xposed/LSPosed/Morphe packages from PackageManager.",
    )

    val sanitizeStackTraces by booleanOption(
        key = "sanitizeStackTraces",
        default = ${config.sanitizeStackTraces},
        title = "Sanitize Stack Traces",
        description = "Filter Xposed, LSPHooker, EdHooker, and PinSpoof frames from Thread/Throwable.getStackTrace().",
    )

    val spoofMotionSensors by booleanOption(
        key = "spoofMotionSensors",
        default = ${config.spoofMotionSensors},
        title = "Spoof Motion Sensors (Stationary)",
        description = "Clamp accelerometer, gyroscope, and significant-motion sensors to resting desk values.",
    )

    val spoofPackageSignature by booleanOption(
        key = "spoofPackageSignature",
        default = ${config.spoofPackageSignature},
        title = "Static Package Signature Spoof",
        description = "Replace PackageInfo.signatures returned by PackageManager.getPackageInfo() with Original Certificate DER Hex.",
    )

    val originalSignatureHex by stringOption(
        key = "originalSignatureHex",
        default = "${escapedSigHex}",
        title = "Original Certificate DER Hex",
        description = "Optional hex-encoded X.509 DER certificate used when Static Package Signature Spoof is enabled.",
    )

    val softFailIntegrityChecks by booleanOption(
        key = "softFailIntegrityChecks",
        default = ${config.softFailIntegrityChecks},
        title = "Play Integrity / SafetyNet Soft-Fail",
        description = "Clear local Integrity / SafetyNet / attestation exceptions on Task.getException() checks.",
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
        description = "Emit Log.d(\\"PinSpoof\\", ...) traces when patched hooks intercept pinning or focus events.",
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
        Fingerprint(definingClass = EXTENSION_CLASS, name = "cloakPackagesEnabled")
            .method
            .returnEarly(cloakPackagesAndInstaller == true)
        Fingerprint(definingClass = EXTENSION_CLASS, name = "spoofSignatureEnabled")
            .method
            .returnEarly(spoofPackageSignature == true)

        val escapedSigHex = (originalSignatureHex ?: "")
            .replace("\\\\", "")
            .replace("\\"", "")
            .replace(":", "")
            .replace(" ", "")
            .trim()
        if (escapedSigHex.isNotEmpty()) {
            Fingerprint(definingClass = EXTENSION_CLASS, name = "originalSignatureHex")
                .method
                .addInstructions(
                    0,
                    """
                        const-string v0, "\$escapedSigHex"
                        return-object v0
                    """.trimIndent(),
                )
        }

        if (hookActivityLockTask == true) {
            rewriteInstanceCalls(
                methodName = "startLockTask",
                parameters = emptyList(),
                returnType = "V",
                matchesReceiver = { isActivityType(it) },
                targetMethod = "\$EXTENSION_CLASS->startLockTask(Landroid/app/Activity;)V",
            )
            rewriteInstanceCalls(
                methodName = "stopLockTask",
                parameters = emptyList(),
                returnType = "V",
                matchesReceiver = { isActivityType(it) },
                targetMethod = "\$EXTENSION_CLASS->stopLockTask(Landroid/app/Activity;)V",
            )
            swallowLockTaskTokenCalls(includeBinderProxies = hookBinderProxies == true)
        }

        if (hookActivityManagerState == true) {
            rewriteInstanceCalls(
                methodName = "getLockTaskModeState",
                parameters = emptyList(),
                returnType = "I",
                matchesReceiver = { it == "Landroid/app/ActivityManager;" },
                targetMethod = "\$EXTENSION_CLASS->getLockTaskModeState(Landroid/app/ActivityManager;)I",
            )
            rewriteInstanceCalls(
                methodName = "isInLockTaskMode",
                parameters = emptyList(),
                returnType = "Z",
                matchesReceiver = { it == "Landroid/app/ActivityManager;" },
                targetMethod = "\$EXTENSION_CLASS->isInLockTaskMode(Landroid/app/ActivityManager;)Z",
            )
        }

        if (hideFocusLoss == true) {
            rewriteInstanceCalls(
                methodName = "hasWindowFocus",
                parameters = emptyList(),
                returnType = "Z",
                matchesReceiver = { isActivityType(it) },
                targetMethod = "\$EXTENSION_CLASS->hasWindowFocus(Landroid/app/Activity;)Z",
            )
            rewriteInstanceCalls(
                methodName = "hasWindowFocus",
                parameters = emptyList(),
                returnType = "Z",
                matchesReceiver = { isViewType(it) },
                targetMethod = "\$EXTENSION_CLASS->hasWindowFocus(Landroid/view/View;)Z",
            )
            rewriteInstanceCalls(
                methodName = "getRunningAppProcesses",
                parameters = emptyList(),
                returnType = "Ljava/util/List;",
                matchesReceiver = { it == "Landroid/app/ActivityManager;" },
                targetMethod = "\$EXTENSION_CLASS->getRunningAppProcesses(Landroid/app/ActivityManager;)Ljava/util/List;",
            )
            methodCall(
                smali = "Landroid/app/ActivityManager;->getMyMemoryState(Landroid/app/ActivityManager\\\$RunningAppProcessInfo;)V"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "\$EXTENSION_CLASS->getMyMemoryState(Landroid/app/ActivityManager\\\$RunningAppProcessInfo;)V",
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
                targetMethod = "\$EXTENSION_CLASS->onWebViewPause(Landroid/webkit/WebView;)V",
            )
            rewriteInstanceCalls(
                methodName = "pauseTimers",
                parameters = emptyList(),
                returnType = "V",
                matchesReceiver = { isWebViewType(it) },
                targetMethod = "\$EXTENSION_CLASS->onWebViewPauseTimers(Landroid/webkit/WebView;)V",
            )
            rewriteInstanceCalls(
                methodName = "getWindowVisibility",
                parameters = emptyList(),
                returnType = "I",
                matchesReceiver = { isWebViewType(it) },
                targetMethod = "\$EXTENSION_CLASS->getWebViewWindowVisibility(Landroid/webkit/WebView;)I",
            )
            rewriteInstanceCalls(
                methodName = "setWebViewClient",
                parameters = listOf("Landroid/webkit/WebViewClient;"),
                returnType = "V",
                matchesReceiver = { isWebViewType(it) },
                targetMethod = "\$EXTENSION_CLASS->onWebViewSetClient(Landroid/webkit/WebView;Landroid/webkit/WebViewClient;)V",
            )
            rewriteInstanceCalls(
                methodName = "loadUrl",
                parameters = listOf("Ljava/lang/String;"),
                returnType = "V",
                matchesReceiver = { isWebViewType(it) },
                targetMethod = "\$EXTENSION_CLASS->onWebViewLoadUrl(Landroid/webkit/WebView;Ljava/lang/String;)V",
            )
            rewriteInstanceCalls(
                methodName = "loadUrl",
                parameters = listOf("Ljava/lang/String;", "Ljava/util/Map;"),
                returnType = "V",
                matchesReceiver = { isWebViewType(it) },
                targetMethod = "\$EXTENSION_CLASS->onWebViewLoadUrl(Landroid/webkit/WebView;Ljava/lang/String;Ljava/util/Map;)V",
            )
        }

        if (hideMultiWindowAndPip == true) {
            rewriteInstanceCalls(
                methodName = "isInMultiWindowMode",
                parameters = emptyList(),
                returnType = "Z",
                matchesReceiver = { isActivityType(it) },
                targetMethod = "\$EXTENSION_CLASS->isInMultiWindowMode(Landroid/app/Activity;)Z",
            )
            rewriteInstanceCalls(
                methodName = "isInPictureInPictureMode",
                parameters = emptyList(),
                returnType = "Z",
                matchesReceiver = { isActivityType(it) },
                targetMethod = "\$EXTENSION_CLASS->isInPictureInPictureMode(Landroid/app/Activity;)Z",
            )
        }

        if (spoofPinnedInsets == true) {
            rewriteInstanceCalls(
                methodName = "getInsets",
                parameters = listOf("I"),
                returnType = "Landroid/graphics/Insets;",
                matchesReceiver = { it == "Landroid/view/WindowInsets;" },
                targetMethod = "\$EXTENSION_CLASS->getWindowInsets(Landroid/view/WindowInsets;I)Landroid/graphics/Insets;",
            )
            rewriteInstanceCalls(
                methodName = "isVisible",
                parameters = listOf("I"),
                returnType = "Z",
                matchesReceiver = { it == "Landroid/view/WindowInsets;" },
                targetMethod = "\$EXTENSION_CLASS->isWindowInsetsVisible(Landroid/view/WindowInsets;I)Z",
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
                    targetMethod = "\$EXTENSION_CLASS->getZeroSystemInset(Landroid/view/WindowInsets;)I",
                )
            }
        }

        if (stripFlagSecure == true) {
            rewriteInstanceCalls(
                methodName = "setFlags",
                parameters = listOf("I", "I"),
                returnType = "V",
                matchesReceiver = { isWindowType(it) },
                targetMethod = "\$EXTENSION_CLASS->windowSetFlags(Landroid/view/Window;II)V",
            )
            rewriteInstanceCalls(
                methodName = "addFlags",
                parameters = listOf("I"),
                returnType = "V",
                matchesReceiver = { isWindowType(it) },
                targetMethod = "\$EXTENSION_CLASS->windowAddFlags(Landroid/view/Window;I)V",
            )
            rewriteInstanceCalls(
                methodName = "setSecure",
                parameters = listOf("Z"),
                returnType = "V",
                matchesReceiver = { isSurfaceViewType(it) },
                targetMethod = "\$EXTENSION_CLASS->surfaceViewSetSecure(Landroid/view/SurfaceView;Z)V",
            )
        }

        if (bypassVirtualDisplays == true) {
            rewriteInstanceCalls(
                methodName = "getDisplays",
                parameters = emptyList(),
                returnType = "[Landroid/view/Display;",
                matchesReceiver = { it == "Landroid/hardware/display/DisplayManager;" },
                targetMethod = "\$EXTENSION_CLASS->getDisplays(Landroid/hardware/display/DisplayManager;)[Landroid/view/Display;",
            )
            rewriteInstanceCalls(
                methodName = "getDisplays",
                parameters = listOf("Ljava/lang/String;"),
                returnType = "[Landroid/view/Display;",
                matchesReceiver = { it == "Landroid/hardware/display/DisplayManager;" },
                targetMethod = "\$EXTENSION_CLASS->getDisplays(Landroid/hardware/display/DisplayManager;Ljava/lang/String;)[Landroid/view/Display;",
            )
            rewriteInstanceCalls(
                methodName = "getDisplay",
                parameters = listOf("I"),
                returnType = "Landroid/view/Display;",
                matchesReceiver = { it == "Landroid/hardware/display/DisplayManager;" },
                targetMethod = "\$EXTENSION_CLASS->getDisplay(Landroid/hardware/display/DisplayManager;I)Landroid/view/Display;",
            )
        }

        if (unblockClipboard == true) {
            rewriteInstanceCalls(
                methodName = "clearPrimaryClip",
                parameters = emptyList(),
                returnType = "V",
                matchesReceiver = { it == "Landroid/content/ClipboardManager;" },
                targetMethod = "\$EXTENSION_CLASS->onClipboardClear(Landroid/content/ClipboardManager;)V",
            )
            rewriteInstanceCalls(
                methodName = "setPrimaryClip",
                parameters = listOf("Landroid/content/ClipData;"),
                returnType = "V",
                matchesReceiver = { it == "Landroid/content/ClipboardManager;" },
                targetMethod = "\$EXTENSION_CLASS->onClipboardSetPrimaryClip(Landroid/content/ClipboardManager;Landroid/content/ClipData;)V",
            )
        }

        if (hideAccessibilityAndOverlays == true) {
            methodCall(
                smali = "Landroid/view/accessibility/AccessibilityManager;->getEnabledAccessibilityServiceList(I)Ljava/util/List;"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "\$EXTENSION_CLASS->getEnabledAccessibilityServiceList(Landroid/view/accessibility/AccessibilityManager;I)Ljava/util/List;",
                    )
                }
            }
            methodCall(
                smali = "Landroid/provider/Settings;->canDrawOverlays(Landroid/content/Context;)Z"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "\$EXTENSION_CLASS->canDrawOverlays(Landroid/content/Context;)Z",
                    )
                }
            }
        }

        if (cloakPackagesAndInstaller == true) {
            rewriteInstanceCalls(
                methodName = "getInstallerPackageName",
                parameters = listOf("Ljava/lang/String;"),
                returnType = "Ljava/lang/String;",
                matchesReceiver = { it == "Landroid/content/pm/PackageManager;" },
                targetMethod = "\$EXTENSION_CLASS->getInstallerPackageName(Landroid/content/pm/PackageManager;Ljava/lang/String;)Ljava/lang/String;",
            )
            rewriteInstanceCalls(
                methodName = "getInstalledPackages",
                parameters = listOf("I"),
                returnType = "Ljava/util/List;",
                matchesReceiver = { it == "Landroid/content/pm/PackageManager;" },
                targetMethod = "\$EXTENSION_CLASS->getInstalledPackages(Landroid/content/pm/PackageManager;I)Ljava/util/List;",
            )
            rewriteInstanceCalls(
                methodName = "getInstalledApplications",
                parameters = listOf("I"),
                returnType = "Ljava/util/List;",
                matchesReceiver = { it == "Landroid/content/pm/PackageManager;" },
                targetMethod = "\$EXTENSION_CLASS->getInstalledApplications(Landroid/content/pm/PackageManager;I)Ljava/util/List;",
            )
            rewriteInstanceCalls(
                methodName = "queryIntentActivities",
                parameters = listOf("Landroid/content/Intent;", "I"),
                returnType = "Ljava/util/List;",
                matchesReceiver = { it == "Landroid/content/pm/PackageManager;" },
                targetMethod = "\$EXTENSION_CLASS->queryIntentActivities(Landroid/content/pm/PackageManager;Landroid/content/Intent;I)Ljava/util/List;",
            )
        }

        if (cloakPackagesAndInstaller == true || spoofPackageSignature == true) {
            rewriteInstanceCalls(
                methodName = "getPackageInfo",
                parameters = listOf("Ljava/lang/String;", "I"),
                returnType = "Landroid/content/pm/PackageInfo;",
                matchesReceiver = { it == "Landroid/content/pm/PackageManager;" },
                targetMethod = "\$EXTENSION_CLASS->getPackageInfo(Landroid/content/pm/PackageManager;Ljava/lang/String;I)Landroid/content/pm/PackageInfo;",
            )
        }

        if (sanitizeStackTraces == true) {
            methodCall(
                smali = "Ljava/lang/Thread;->getStackTrace()[Ljava/lang/StackTraceElement;"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "\$EXTENSION_CLASS->getThreadStackTrace(Ljava/lang/Thread;)[Ljava/lang/StackTraceElement;",
                    )
                }
            }
            methodCall(
                smali = "Ljava/lang/Throwable;->getStackTrace()[Ljava/lang/StackTraceElement;"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "\$EXTENSION_CLASS->getThrowableStackTrace(Ljava/lang/Throwable;)[Ljava/lang/StackTraceElement;",
                    )
                }
            }
        }

        if (spoofMotionSensors == true) {
            methodCall(
                smali = "Landroid/hardware/SensorManager;->requestTriggerSensor(Landroid/hardware/TriggerEventListener;Landroid/hardware/Sensor;)Z"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "\$EXTENSION_CLASS->requestTriggerSensor(Landroid/hardware/SensorManager;Landroid/hardware/TriggerEventListener;Landroid/hardware/Sensor;)Z",
                    )
                }
            }
        }

        if (softFailIntegrityChecks == true) {
            listOf(
                "Lcom/google/android/gms/tasks/Task;->getException()Ljava/lang/Exception;",
                "Lcom/google/android/play/core/tasks/Task;->getException()Ljava/lang/Exception;",
            ).forEach { sig ->
                methodCall(smali = sig).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                    if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                        replaceCallAt(
                            index,
                            "\$EXTENSION_CLASS->softFailTaskException(Ljava/lang/Object;)Ljava/lang/Exception;",
                        )
                    }
                }
            }
        }

        if (hookSettingsLockToApp == true) {
            methodCall(
                smali = "Landroid/provider/Settings\\\$System;->getInt(Landroid/content/ContentResolver;Ljava/lang/String;I)I"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "\$EXTENSION_CLASS->getSettingsSystemInt(Landroid/content/ContentResolver;Ljava/lang/String;I)I",
                    )
                }
            }
            methodCall(
                smali = "Landroid/provider/Settings\\\$System;->getInt(Landroid/content/ContentResolver;Ljava/lang/String;)I"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "\$EXTENSION_CLASS->getSettingsSystemInt(Landroid/content/ContentResolver;Ljava/lang/String;)I",
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
                        "\$EXTENSION_CLASS->isLockTaskPermitted(Landroid/app/admin/DevicePolicyManager;Ljava/lang/String;)Z",
                    )
                }
            }
        }

        if (hideFocusLoss == true ||
            hideWebViewVisibility == true ||
            hideLifecycleLoss == true ||
            retainAudioFocus == true ||
            spoofMotionSensors == true ||
            bypassVirtualDisplays == true
        ) {
            patchAppSubclassOverrides(
                hideFocus = hideFocusLoss == true,
                hideWebView = hideWebViewVisibility == true,
                hideLifecycle = hideLifecycleLoss == true,
                retainAudio = retainAudioFocus == true,
                spoofSensors = spoofMotionSensors == true,
                bypassDisplays = bypassVirtualDisplays == true,
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
                replaceInstruction(index, "invoke-static {}, \$EXTENSION_CLASS->onLockTaskTokenCall()V")
            }
        }
    }
}

private fun MutableMethod.replaceCallAt(index: Int, targetMethod: String) {
    val insn = getInstruction(index)
    val regs = insn.registersUsed
    val useRange = insn.opcode.name.endsWith("_RANGE") || regs.any { it > 15 }
    val invokeSmali = when {
        regs.isEmpty() -> "invoke-static {}, \$targetMethod"
        useRange -> "invoke-static/range { v\${regs.first()} .. v\${regs.last()} }, \$targetMethod"
        else -> "invoke-static { \${regs.joinToString(", ") { "v\$it" }} }, \$targetMethod"
    }
    replaceInstruction(index, invokeSmali)
}

private fun BytecodePatchContext.patchAppSubclassOverrides(
    hideFocus: Boolean,
    hideWebView: Boolean,
    hideLifecycle: Boolean,
    retainAudio: Boolean,
    spoofSensors: Boolean,
    bypassDisplays: Boolean,
) {
    val activityTargets = mutableListOf<ClassDef>()
    val fragmentTargets = mutableListOf<ClassDef>()
    val viewTargets = mutableListOf<ClassDef>()
    val webViewClientTargets = mutableListOf<ClassDef>()
    val lifecycleCallbackTargets = mutableListOf<ClassDef>()
    val focusListenerTargets = mutableListOf<ClassDef>()
    val windowFocusHolderTargets = mutableListOf<ClassDef>()
    val broadcastReceiverTargets = mutableListOf<ClassDef>()
    val audioListenerTargets = mutableListOf<ClassDef>()
    val sensorListenerTargets = mutableListOf<ClassDef>()
    val displayListenerTargets = mutableListOf<ClassDef>()

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
                        (hideWebView && ((m.name == "onWindowVisibilityChanged" && m.parameterTypes == listOf("I") && m.returnType == "V") ||
                            (m.name == "onVisibilityAggregated" && m.parameterTypes == listOf("Z") && m.returnType == "V")))
                    )
            }
            if (hasViewHook) viewTargets += classDef
        }

        if (hideWebView && isWebViewClientType(type)) {
            val hasWebCb = classDef.methods.any { m ->
                m.implementation != null && (
                    (m.name == "onPageFinished" &&
                        m.parameterTypes == listOf("Landroid/webkit/WebView;", "Ljava/lang/String;") &&
                        m.returnType == "V") ||
                        (m.name == "onPageStarted" &&
                            m.parameterTypes == listOf("Landroid/webkit/WebView;", "Ljava/lang/String;", "Landroid/graphics/Bitmap;") &&
                            m.returnType == "V")
                    )
            }
            if (hasWebCb) webViewClientTargets += classDef
        }

        if (hideLifecycle && "Landroid/app/Application\\\$ActivityLifecycleCallbacks;" in classDef.interfaces) {
            val hasCb = classDef.methods.any { m ->
                m.implementation != null &&
                    (m.name == "onActivityPaused" || m.name == "onActivityStopped") &&
                    m.parameterTypes == listOf("Landroid/app/Activity;") &&
                    m.returnType == "V"
            }
            if (hasCb) lifecycleCallbackTargets += classDef
        }

        if (hideFocus && "Landroid/view/ViewTreeObserver\\\$OnWindowFocusChangeListener;" in classDef.interfaces) {
            val hasListener = classDef.methods.any { m ->
                m.implementation != null &&
                    m.name == "onWindowFocusChanged" &&
                    m.parameterTypes == listOf("Z") &&
                    m.returnType == "V"
            }
            if (hasListener) focusListenerTargets += classDef
        }

        if (hideFocus && !isActivityType(type) && !isViewType(type) &&
            (hasAncestorIn(type, setOf("Landroid/app/Dialog;")) || "Landroid/view/Window\\\$Callback;" in classDef.interfaces)
        ) {
            val hasFocusCb = classDef.methods.any { m ->
                m.implementation != null &&
                    m.name == "onWindowFocusChanged" &&
                    m.parameterTypes == listOf("Z") &&
                    m.returnType == "V"
            }
            if (hasFocusCb) windowFocusHolderTargets += classDef
        }

        if (hideFocus && hasAncestorIn(type, setOf("Landroid/content/BroadcastReceiver;"))) {
            val hasOnReceive = classDef.methods.any { m ->
                m.implementation != null &&
                    m.name == "onReceive" &&
                    m.parameterTypes == listOf("Landroid/content/Context;", "Landroid/content/Intent;") &&
                    m.returnType == "V"
            }
            if (hasOnReceive) broadcastReceiverTargets += classDef
        }

        if (retainAudio && "Landroid/media/AudioManager\\\$OnAudioFocusChangeListener;" in classDef.interfaces) {
            val hasAudio = classDef.methods.any { m ->
                m.implementation != null &&
                    m.name == "onAudioFocusChange" &&
                    m.parameterTypes == listOf("I") &&
                    m.returnType == "V"
            }
            if (hasAudio) audioListenerTargets += classDef
        }

        if (spoofSensors && "Landroid/hardware/SensorEventListener;" in classDef.interfaces) {
            val hasSensor = classDef.methods.any { m ->
                m.implementation != null &&
                    m.name == "onSensorChanged" &&
                    m.parameterTypes == listOf("Landroid/hardware/SensorEvent;") &&
                    m.returnType == "V"
            }
            if (hasSensor) sensorListenerTargets += classDef
        }

        if (bypassDisplays && "Landroid/hardware/display/DisplayManager\\\$DisplayListener;" in classDef.interfaces) {
            val hasDisplayCb = classDef.methods.any { m ->
                m.implementation != null &&
                    (m.name == "onDisplayAdded" || m.name == "onDisplayChanged") &&
                    m.parameterTypes == listOf("I") &&
                    m.returnType == "V"
            }
            if (hasDisplayCb) displayListenerTargets += classDef
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
            } else if (hideWebView &&
                method.name == "onVisibilityAggregated" &&
                method.parameterTypes == listOf("Z") &&
                method.returnType == "V"
            ) {
                forceVisibilityAggregatedTrue(method)
            }
        }
    }

    webViewClientTargets.forEach { classDef ->
        val mutable = mutableClassDefBy(classDef)
        for (method in mutable.methods.toList()) {
            if (method.implementation == null) continue
            if ((method.name == "onPageFinished" &&
                    method.parameterTypes == listOf("Landroid/webkit/WebView;", "Ljava/lang/String;") &&
                    method.returnType == "V") ||
                (method.name == "onPageStarted" &&
                    method.parameterTypes == listOf("Landroid/webkit/WebView;", "Ljava/lang/String;", "Landroid/graphics/Bitmap;") &&
                    method.returnType == "V")
            ) {
                method.addInstructions(
                    0,
                    "invoke-static/range { p1 .. p1 }, \$EXTENSION_CLASS->injectWebViewStealth(Landroid/webkit/WebView;)V",
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

    windowFocusHolderTargets.forEach { classDef ->
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

    broadcastReceiverTargets.forEach { classDef ->
        val mutable = mutableClassDefBy(classDef)
        for (method in mutable.methods.toList()) {
            if (method.implementation == null) continue
            if (method.name == "onReceive" &&
                method.parameterTypes == listOf("Landroid/content/Context;", "Landroid/content/Intent;") &&
                method.returnType == "V"
            ) {
                suppressCloseSystemDialogsBroadcast(method)
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

    sensorListenerTargets.forEach { classDef ->
        val mutable = mutableClassDefBy(classDef)
        for (method in mutable.methods.toList()) {
            if (method.implementation == null) continue
            if (method.name == "onSensorChanged" &&
                method.parameterTypes == listOf("Landroid/hardware/SensorEvent;") &&
                method.returnType == "V"
            ) {
                method.addInstructions(
                    0,
                    "invoke-static/range { p1 .. p1 }, \$EXTENSION_CLASS->sanitizeSensorEvent(Landroid/hardware/SensorEvent;)V",
                )
            }
        }
    }

    displayListenerTargets.forEach { classDef ->
        val mutable = mutableClassDefBy(classDef)
        for (method in mutable.methods.toList()) {
            if (method.implementation == null) continue
            if ((method.name == "onDisplayAdded" || method.name == "onDisplayChanged") &&
                method.parameterTypes == listOf("I") &&
                method.returnType == "V"
            ) {
                skipNonDefaultDisplayCallback(method)
            }
        }
    }

    if (hideLifecycle) {
        classDefByOrNull("Landroidx/lifecycle/LifecycleRegistry;")?.let { registryClass ->
            val mutable = mutableClassDefBy(registryClass)
            val handleMethod = mutable.methods.firstOrNull {
                it.implementation != null &&
                    it.name == "handleLifecycleEvent" &&
                    it.parameterTypes == listOf("Landroidx/lifecycle/Lifecycle\\\$Event;") &&
                    it.returnType == "V"
            }
            if (handleMethod != null) {
                prepareEntryScratch(handleMethod) { freeReg, _, p1Reg ->
                    """
                        invoke-static/range { \$p1Reg .. \$p1Reg }, \$EXTENSION_CLASS->shouldSuppressLifecycleEvent(Ljava/lang/Object;)Z
                        move-result \$freeReg
                        if-eqz \$freeReg, :pinspoof_orig
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

private fun skipNonDefaultDisplayCallback(method: MutableMethod) {
    method.addInstructions(
        0,
        """
            if-eqz p1, :pinspoof_default
            return-void
            :pinspoof_default
            nop
        """.trimIndent(),
    )
}

private fun forceWindowVisibilityVisible(method: MutableMethod) {
    method.addInstructions(
        0,
        """
            invoke-static/range { p1 .. p1 }, \$EXTENSION_CLASS->filterWindowVisibility(I)I
            move-result p1
        """.trimIndent(),
    )
}

private fun forceVisibilityAggregatedTrue(method: MutableMethod) {
    method.addInstructions(
        0,
        """
            invoke-static/range { p1 .. p1 }, \$EXTENSION_CLASS->filterVisibilityAggregated(Z)Z
            move-result p1
        """.trimIndent(),
    )
}

private fun BytecodePatchContext.suppressCloseSystemDialogsBroadcast(method: MutableMethod) {
    val impl = method.implementation ?: return
    val origP0 = method.p0Register
    val paramRegs = if (origP0 < impl.registerCount) {
        IntArray(impl.registerCount - origP0) { origP0 + it }
    } else {
        intArrayOf()
    }
    val free = runCatching { method.findFreeRegister(0, *paramRegs) }.getOrNull()
    if (free != null && free < 256) {
        method.addInstructions(
            0,
            """
                invoke-static/range { p2 .. p2 }, \$EXTENSION_CLASS->shouldSuppressBroadcast(Landroid/content/Intent;)Z
                move-result v\$free
                if-eqz v\$free, :pinspoof_orig
                return-void
                :pinspoof_orig
                nop
            """.trimIndent(),
        )
        return
    }
    if (impl.registerCount < 250) {
        val cloned = method.cloneParameters()
        val insertIdx = cloned.numberOfParameterRegistersLogical
        val intentReg = "v\${origP0 + 2}"
        cloned.addInstructions(
            insertIdx,
            """
                invoke-static/range { \$intentReg .. \$intentReg }, \$EXTENSION_CLASS->shouldSuppressBroadcast(Landroid/content/Intent;)Z
                move-result p0
                if-eqz p0, :pinspoof_orig
                return-void
                :pinspoof_orig
                nop
            """.trimIndent(),
        )
    }
}

private fun BytecodePatchContext.suppressAudioFocusLoss(method: MutableMethod) {
    prepareEntryScratch(method) { freeReg, _, p1Reg ->
        """
            invoke-static/range { \$p1Reg .. \$p1Reg }, \$EXTENSION_CLASS->shouldSuppressAudioFocusLoss(I)Z
            move-result \$freeReg
            if-eqz \$freeReg, :pinspoof_orig
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
            "invoke-super/range { \$p0Reg .. \$p0Reg }, \$superType->\$methodName()V\\n"
        } else {
            ""
        }
        """
            invoke-static/range { \$p0Reg .. \$p0Reg }, \$EXTENSION_CLASS->shouldSuppressLifecycle(Landroid/app/Activity;)Z
            move-result \$freeReg
            if-eqz \$freeReg, :pinspoof_orig
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
            invoke-virtual/range { \$p0Reg .. \$p0Reg }, \$superType->getActivity()Landroid/app/Activity;
            move-result-object \$freeReg
            invoke-static/range { \$freeReg .. \$freeReg }, \$EXTENSION_CLASS->shouldSuppressLifecycle(Landroid/app/Activity;)Z
            move-result \$freeReg
            if-eqz \$freeReg, :pinspoof_orig
            invoke-super/range { \$p0Reg .. \$p0Reg }, \$superType->\$methodName()V
            return-void
            :pinspoof_orig
            nop
        """.trimIndent()
    }
}

private fun BytecodePatchContext.skipLifecycleCallbackIfNotFinishing(method: MutableMethod) {
    prepareEntryScratch(method) { freeReg, _, p1Reg ->
        """
            invoke-static/range { \$p1Reg .. \$p1Reg }, \$EXTENSION_CLASS->shouldSuppressLifecycle(Landroid/app/Activity;)Z
            move-result \$freeReg
            if-eqz \$freeReg, :pinspoof_orig
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
        method.addInstructions(0, buildSmali("v\$free", "p0", "p1"))
        return
    }
    if (impl.registerCount < 250) {
        val cloned = method.cloneParameters()
        val insertIdx = cloned.numberOfParameterRegistersLogical
        cloned.addInstructions(
            insertIdx,
            buildSmali("p0", "v\$origP0", "v\${origP0 + 1}"),
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
import android.os.Process;
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
import android.webkit.WebViewClient;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Runtime hook targets merged into the patched APK by ${config.moduleName} v${config.versionName} Morphe Patch.
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
                    + "if((e.type==='blur'||e.type==='focusout')&&e.target!==window&&e.target!==document)return;"
                    + "e.stopImmediatePropagation();"
                    + "};"
                    + "window.addEventListener('blur',s,true);"
                    + "window.addEventListener('focusout',s,true);"
                    + "window.addEventListener('pagehide',s,true);"
                    + "document.addEventListener('blur',s,true);"
                    + "document.addEventListener('focusout',s,true);"
                    + "document.addEventListener('visibilitychange',s,true);"
                    + "document.addEventListener('webkitvisibilitychange',s,true);"
                    + "document.addEventListener('freeze',s,true);"
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

    public static List<ActivityManager.RunningAppProcessInfo> getRunningAppProcesses(ActivityManager am) {
        if (am == null) {
            return Collections.emptyList();
        }
        List<ActivityManager.RunningAppProcessInfo> list = am.getRunningAppProcesses();
        if (list != null) {
            int myPid = Process.myPid();
            for (ActivityManager.RunningAppProcessInfo info : list) {
                if (info != null && info.pid == myPid) {
                    info.importance = ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND;
                    info.importanceReasonCode = ActivityManager.RunningAppProcessInfo.REASON_UNKNOWN;
                }
            }
        }
        return list;
    }

    public static boolean shouldSuppressBroadcast(Intent intent) {
        boolean suppress = intent != null && Intent.ACTION_CLOSE_SYSTEM_DIALOGS.equals(intent.getAction());
        if (suppress) {
            log("Suppressed Intent.ACTION_CLOSE_SYSTEM_DIALOGS broadcast");
        }
        return suppress;
    }

    public static int filterWindowVisibility(int visibility) {
        if (visibility != View.VISIBLE) {
            log("View/WebView window visibility coerced to View.VISIBLE");
        }
        return View.VISIBLE;
    }

    public static int getWebViewWindowVisibility(WebView webView) {
        return View.VISIBLE;
    }

    public static boolean filterVisibilityAggregated(boolean isVisible) {
        if (!isVisible) {
            log("WebView onVisibilityAggregated(false) coerced to true");
        }
        return true;
    }

    public static void onWebViewSetClient(WebView webView, WebViewClient client) {
        if (webView != null) {
            webView.setWebViewClient(client);
            injectWebViewStealth(webView);
        }
    }

    public static void onWebViewLoadUrl(WebView webView, String url) {
        if (webView != null) {
            webView.loadUrl(url);
            injectWebViewStealth(webView);
        }
    }

    public static void onWebViewLoadUrl(WebView webView, String url, Map<String, String> headers) {
        if (webView != null) {
            webView.loadUrl(url, headers);
            injectWebViewStealth(webView);
        }
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
  const ver = config.versionName.trim() || '1.4.0';
  return `# ${config.moduleName}

App-scoped Xposed (LSPosed / LSPatch) module **and** rootless Morphe Patch Bundle targeting **Android 7.0 – Android 16 (API ${config.minSdk}–${config.targetSdk})**:

1. **Disables System App Pinning**: Intercepts \`Activity.startLockTask()\`, \`Activity.stopLockTask()\`, \`ActivityClient\`, and Binder \`Stub$Proxy\` calls locally within the target app's ART process without modifying \`system_server\`.
2. **Emulates Pinned State**: Reports \`ActivityManager.getLockTaskModeState()\` -> \`LOCK_TASK_MODE_PINNED\` (\`2\`) and \`isInLockTaskMode()\` -> \`true\` when active, alongside optional \`Settings.System\` (\`lock_to_app_enabled\`) and \`DevicePolicyManager.isLockTaskPermitted()\` overrides.
3. **Preserves Foreground, Focus & Recents State**:
   - Filters \`BroadcastReceiver.onReceive()\` for \`Intent.ACTION_CLOSE_SYSTEM_DIALOGS\` (\`recentapps\` / \`homekey\`) via dynamic \`registerReceiver\` hooking in LSPosed and direct bytecode patching in Morphe.
   - Suppresses \`onWindowFocusChanged(false)\` across \`Activity\`, app subclasses, \`DecorView\`, \`Dialog\`, and \`Window.Callback\` listeners, plus API 29+ \`Activity.onTopResumedActivityChanged(false)\` and \`onUserLeaveHint()\`.
   - Keeps \`hasWindowFocus() -> true\` and reports \`IMPORTANCE_FOREGROUND\` across both \`ActivityManager.getMyMemoryState()\` and \`ActivityManager.getRunningAppProcesses()\`.
4. **WebView & Fragment Lifecycle Continuity**:
   - Injects DOM focus/visibility continuity across \`onPageStarted\`, \`onPageFinished\`, \`onAttachedToWindow\`, \`setWebViewClient()\`, and \`loadUrl()\`, suppressing \`focusout\`, \`pagehide\`, \`freeze\`, \`blur\`, \`visibilitychange\`, and \`webkitvisibilitychange\` while preserving \`document.hidden = false\`, \`document.visibilityState = "visible"\`, and \`document.hasFocus() = true\`.
   - Maintains \`WebView.getWindowVisibility() -> View.VISIBLE\`, \`dispatchWindowVisibilityChanged\`, and API 24+ \`onVisibilityAggregated(false) -> true\`.
   - Extends \`onPause()\` / \`onStop()\` preservation to \`androidx.fragment.app.Fragment\`, \`android.app.Fragment\`, \`Application.ActivityLifecycleCallbacks\`, and \`LifecycleRegistry\` (\`ON_PAUSE\` / \`ON_STOP\`).
5. **Display, Media, Sensor & Environment Compatibility**:
   - **Display & Screenshot Controls**: Removes \`FLAG_SECURE\` on \`Window\` and \`SurfaceView\` so screenshots and screen recording work normally, simulates zeroed pinned \`WindowInsets\`, and exposes \`Display.DEFAULT_DISPLAY\` in \`DisplayManager\` while filtering secondary display callbacks.
   - **Audio & Clipboard Preservation**: Retains \`AudioManager\` audio focus across interruptions and blocks \`ClipboardManager.clearPrimaryClip()\` or blank \`setPrimaryClip()\` clipboard wipes.
   - **Motion Sensor Stabilization**: Provides steady resting readings for accelerometer, gravity, gyroscope, and linear-acceleration events and suppresses \`TYPE_SIGNIFICANT_MOTION\` triggers for apps that interrupt UI sessions when the device is moved.
   - **Environment, Signature & Integrity Compatibility**: Reports \`com.android.vending\` as the package installer, filters framework/module packages from \`PackageManager\` queries, keeps \`Thread.getStackTrace()\` / \`Throwable.getStackTrace()\` clean of hook frames, filters \`AccessibilityManager\` and overlay state checks, and offers optional original signing certificate DER hex preservation (\`PackageInfo.signatures\` / \`SigningInfo\`) plus graceful \`Task.getException()\` handling for Morphe-repackaged APKs.
6. **Material 3 Expressive UI & Live Hook Inspector**:
   - Configure global defaults or inline per-app overrides with one-tap **Light**, **Balanced**, and **Aggressive** presets, throttled live \`XSharedPreferences\` reloading, JSON profile import/export, real-time hook counters (**Pinning**, **Focus**, **WebView**, **Lifecycle**), and a fullscreen-expandable method-level **Live Hook Event Log** drawer.

## Practical Usage

${config.moduleName} lets you stay in control of multitasking and system navigation without breaking apps that lock the screen or reset their state during brief interruptions:

- **Keep Android Navigation & Recents Unlocked**: Prevent apps from locking your device into Screen Pinning so the Back button, Recents overview, gesture navigation, Quick Settings, and notifications always remain usable without disrupting the app's internal layout or navigation state.
- **Multitask Without State Resets, Clipboard Wipes, or Media Pauses**: Open Recents, pull down the notification shade, check a reference note, reply to a message, or use floating/split-screen windows without triggering unwanted WebView playback/timer pauses, audio focus drops, clipboard clears, or full activity teardowns.
- **Take Screenshots & Cast Freely**: Strip restrictive \`FLAG_SECURE\` flags and secondary-display warnings so you can take personal screenshots, record your screen, or mirror displays without apps blanking out or complaining.
- **No \`system_server\` Scoping Required**: Unlike legacy pinning modules that hook the Android System Framework (\`android\`), ${config.moduleName} operates strictly inside the scoped target app process (or directly inside a Morphe-patched APK without root or LSPosed).
- **One-Tap Presets & Live Hook Diagnostics**: Start immediately with the **Balanced** default profile, switch to **Light** (pinning-only) for games or \`SurfaceView\`-heavy apps, or inspect real-time method hit counts in the Live Hook Event Log to see exactly which hooks an app triggers.

## Option 1: Morphe Patching (No Root / No Xposed)

> **Note:** Morphe re-signs the patched APK. For apps that check signing certificates or client integrity APIs, enable the optional signing certificate DER hex and integrity compatibility toggles in Patching Options, or use **Option 2 (LSPosed)**.

1. Download \`${folderName}-v${ver}.mpp\` from [Releases](https://github.com/redcatxus/PinSpoof/releases) (or build locally in \`morphe-patches/\` via \`gradle :patches:buildAndroid :patches:generatePatchesList\`).
2. Import \`${folderName}-v${ver}.mpp\` into **Morphe Manager** (Expert Mode) or **Morphe Desktop CLI**.
3. Pick any target APK and open **Patching Options** on the **${config.moduleName}** patch to customize your preset or individual toggles (pinning, Recents broadcasts, window focus, WebView JS/visibility, lifecycle preservation, multi-window/PiP, display/screenshot/audio/clipboard controls, sensor stabilization, and environment/signature compatibility).
4. Patch and install the modified APK.

## Option 2: LSPosed Setup

1. Install **\`${folderName}-v${ver}.apk\`** (\`versionCode: ${config.versionCode}\`) from [Releases](https://github.com/redcatxus/PinSpoof/releases).
2. Open **LSPosed Manager** -> **Modules** -> **${config.moduleName}**.
3. Enable the module and select **only the target apps** you want to affect (keep **System Framework (\`android\`) UNCHECKED**).
4. Open the **${config.moduleName}** companion app to select a preset (**Light**, **Balanced**, **Aggressive**) or customize granular toggles globally or per app, open the **Morphe Patch Options** checklist to mirror toggles into Morphe Manager, then force-stop and relaunch your target app.

- **Package ID**: \`${pkg}\`
- **Entry Class**: \`${pkg}.PinSpoofModule\`

## Disclaimer & Support

This project was created with the assistance of Artificial Intelligence and is licensed under **GPL-3.0**. This software is provided **"as-is"**, without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and non-infringement.

**No user support is provided.** Do not expect assistance with troubleshooting, app compatibility, or custom configurations—fork the repository and implement your own changes if needed. Use responsibly and solely on devices and software where you are authorized to do so.
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
