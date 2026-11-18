package us.redcatx.pinspoof

import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.app.admin.DevicePolicyManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentResolver
import android.content.Context
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
 * PinSpoof v1.3.0 — App-Scoped LockTask, Anti-Detection & UI Stealth Module (Android 7 – 16 / API 24 – 36)
 *
 * 1. Reactive mode + safe Window Focus spoofing are ON by default; aggressive pause/stop blocking,
 *    WebView visibility/JS stealth, Binder Stub$Proxy hooks, anti-detection cloaking, virtual display
 *    & clipboard bypass, sensor spoofing, signature spoof, and integrity soft-fail are opt-in.
 * 2. Dynamic method-name scanning for ActivityClient & Binder Stub$Proxy with strict error guards.
 * 3. Throttled live event reporting (counts + method-level event log) to the PinSpoof UI.
 */
class PinSpoofModule : IXposedHookLoadPackage {

    private val spoofedPinned = AtomicBoolean(HookConfig.ALWAYS_SPOOF_PINNED)
    private val hookedActivityClasses = ConcurrentHashMap.newKeySet<String>()
    private val hookedWebViewClients = ConcurrentHashMap.newKeySet<String>()
    private val hookedAudioListeners = ConcurrentHashMap.newKeySet<String>()
    private val hookedSensorListeners = ConcurrentHashMap.newKeySet<String>()
    private val hookedDisplayListeners = ConcurrentHashMap.newKeySet<String>()

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

    private fun readBool(pkg: String, key: String, fallback: Boolean): Boolean {
        val xPrefs = prefs ?: return fallback
        if (xPrefs.hasFileChanged()) {
            xPrefs.reload()
        }
        val hasAppOverride = xPrefs.getBoolean("${pkg}::override", false)
        return if (hasAppOverride) {
            xPrefs.getBoolean("${pkg}::$key", fallback)
        } else {
            xPrefs.getBoolean("global::$key", fallback)
        }
    }

    private fun readString(pkg: String, key: String, fallback: String): String {
        val xPrefs = prefs ?: return fallback
        if (xPrefs.hasFileChanged()) {
            xPrefs.reload()
        }
        val hasAppOverride = xPrefs.getBoolean("${pkg}::override", false)
        return if (hasAppOverride) {
            xPrefs.getString("${pkg}::$key", fallback) ?: fallback
        } else {
            xPrefs.getString("global::$key", fallback) ?: fallback
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
        val key = "$category|$cleanMethod"
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
        log(pkg, "Blocked real pinning via $source; spoofed state = LOCK_TASK_MODE_PINNED (2)")
    }

    private fun markUnpinned(pkg: String, source: String) {
        if (!isAlwaysPinned(pkg)) {
            spoofedPinned.set(false)
            recordStat(pkg, "pin", source)
            log(pkg, "Intercepted unpin via $source; spoofed state = LOCK_TASK_MODE_NONE (0)")
        } else {
            log(pkg, "Intercepted unpin via $source; maintaining always_spoof_pinned = true")
        }
    }

    private fun log(pkg: String, message: String) {
        if (readBool(pkg, "debug_logging", HookConfig.DEBUG_LOGGING)) {
            XposedBridge.log("[${HookConfig.MODULE_TAG}][$pkg] $message")
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

        log(pkg, "Attached to ${lpparam.processName} (SDK ${Build.VERSION.SDK_INT})")
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
            log(pkg, "Failed to hook Activity lock task methods: ${it.message}")
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
            log(pkg, "getLockTaskModeState hook skipped: ${it.message}")
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
            log(pkg, "isInLockTaskMode hook skipped: ${it.message}")
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
            "android.app.IActivityTaskManager\$Stub\$Proxy" to "IActivityTaskManager",
            "android.app.IActivityManager\$Stub\$Proxy" to "IActivityManager"
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
                                            markPinned(pkg, "$label.$name()")
                                            param.result = defaultReturnFor(method.returnType)
                                        }
                                        name.startsWith("stopLockTask") -> {
                                            if (!isModuleEnabled(pkg)) return
                                            markUnpinned(pkg, "$label.$name()")
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
            log(pkg, "$label dynamic lock-task hook error: ${it.message}")
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
                            recordStat(pkg, "focus", "Activity.hasWindowFocus()")
                            param.result = true
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
                                recordStat(pkg, "lifecycle", "LifecycleRegistry($eventName)")
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
                val simpleName = cls.simpleName
                runCatching {
                    val onPause = cls.getDeclaredMethod("onPause")
                    XposedBridge.hookMethod(onPause, object : XC_MethodHook() {
                        override fun beforeHookedMethod(param: MethodHookParam) {
                            val act = param.thisObject as? Activity ?: return
                            if (shouldHideLifecycle(pkg) && !act.isFinishing) {
                                XposedHelpers.setBooleanField(act, "mCalled", true)
                                recordStat(pkg, "lifecycle", "$simpleName.onPause()")
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
                                recordStat(pkg, "lifecycle", "$simpleName.onStop()")
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
                                recordStat(pkg, "focus", "$simpleName.onUserLeaveHint()")
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
                                recordStat(pkg, "focus", "$simpleName.onWindowFocusChanged(false)")
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
                                        recordStat(pkg, "focus", "OnAudioFocusChange($change)")
                                        log(pkg, "Suppressed audio focus loss ($change) on ${cls.simpleName}")
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
                "android.media.AudioFocusRequest\$Builder",
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
                            recordStat(pkg, "cloak", "DisplayManager.getDisplay($id)")
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
                                                    recordStat(pkg, "cloak", "DisplayListener.$mName()")
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
                                    recordStat(pkg, "cloak", "SigningInfo.$mName()")
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
                            val msg = "${ex.javaClass.name} ${ex.message}"
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
            log(pkg, "Settings.System hook skipped: ${it.message}")
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
                            log(pkg, "DevicePolicyManager.isLockTaskPermitted($pkg) -> true")
                        }
                    }
                }
            )
        }.onFailure {
            log(pkg, "DevicePolicyManager hook skipped: ${it.message}")
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
