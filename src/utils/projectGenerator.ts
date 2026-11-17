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
 * Compile-time default hook configuration generated for ${config.moduleName}.
 * When the Material You settings UI is enabled, runtime overrides from
 * XSharedPreferences take precedence per-app or globally.
 * Never requires scoping to system_server ("android").
 */
object HookConfig {
    const val MODULE_TAG = "${config.moduleName}"
    const val MODULE_PKG = "${pkg}"
    const val PREFS_NAME = "pinspoof_prefs"

    const val ALWAYS_SPOOF_PINNED = ${config.spoofTiming === 'always'}
    const val HOOK_ACTIVITY_LOCK_TASK = ${config.hookActivityLockTask}
    const val HOOK_ACTIVITY_MANAGER_STATE = ${config.hookActivityManagerState}
    const val HOOK_BINDER_PROXIES = ${config.hookBinderProxies}
    const val HOOK_ACTIVITY_CLIENT = ${config.hookActivityClient}
    const val HOOK_SETTINGS_LOCK_TO_APP = ${config.hookSettingsLockToApp}
    const val HOOK_DPM_LOCK_TASK_PERMITTED = ${config.hookDevicePolicyPermitted}
    const val HIDE_FOCUS_LOSS = ${config.hideFocusLoss}
    const val HIDE_MULTI_WINDOW_PIP = ${config.hideMultiWindowAndPip}
    const val DEBUG_LOGGING = ${config.debugLogging}
}
`;
}

function generatePinSpoofModuleKt(config: ModuleConfig, pkg: string): string {
  return `package ${pkg}

import android.app.Activity
import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.ContentResolver
import android.os.Build
import android.provider.Settings
import android.view.View
import de.robv.android.xposed.IXposedHookLoadPackage
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XSharedPreferences
import de.robv.android.xposed.XposedBridge
import de.robv.android.xposed.XposedHelpers
import de.robv.android.xposed.callbacks.XC_LoadPackage.LoadPackageParam
import java.util.concurrent.atomic.AtomicBoolean

/**
 * ${config.moduleName} — App-Scoped LockTask & Focus Stealth Module (Android 7 – 16 / API 24 – 36)
 *
 * Strategy:
 * 1. Intercept startLockTask() / stopLockTask() and Binder IPC proxies inside the
 *    target app's own ART process before they cross Binder to system_server.
 * 2. Swallow the IPC call so Android never enters screen pinning or shows SystemUI
 *    pinning dialogs or back/recents lockouts.
 * 3. Spoof ActivityManager.getLockTaskModeState() -> LOCK_TASK_MODE_PINNED (2) and
 *    isInLockTaskMode() -> true.
 * 4. Optionally suppress window/activity focus-loss signals (DecorView.onWindowFocusChanged,
 *    Activity.performTopResumedActivityChanged, hasWindowFocus, and RunningAppProcessInfo)
 *    so the scoped app believes it remains focused and pinned even while backgrounded.
 */
class PinSpoofModule : IXposedHookLoadPackage {

    private val spoofedPinned = AtomicBoolean(HookConfig.ALWAYS_SPOOF_PINNED)

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

    private fun markPinned(pkg: String, source: String) {
        spoofedPinned.set(true)
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
        if (readBool(pkg, "hide_multi_window_pip", HookConfig.HIDE_MULTI_WINDOW_PIP)) {
            hookMultiWindowAndPip(lpparam)
        }
        if (readBool(pkg, "hook_settings_lock_to_app", HookConfig.HOOK_SETTINGS_LOCK_TO_APP)) {
            hookSettingsLockToApp(lpparam)
        }
        if (readBool(pkg, "hook_dpm_permitted", HookConfig.HOOK_DPM_LOCK_TASK_PERMITTED)) {
            hookDevicePolicyPermitted(lpparam)
        }
    }

    private fun hookActivityLockTask(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        try {
            XposedHelpers.findAndHookMethod(
                Activity::class.java,
                "startLockTask",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (!isModuleEnabled(pkg)) return
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
        } catch (t: Throwable) {
            log(pkg, "Failed to hook Activity lock task methods: \${t.message}")
        }
    }

    private fun hookActivityManagerState(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        try {
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
        } catch (t: Throwable) {
            log(pkg, "getLockTaskModeState hook skipped: \${t.message}")
        }

        try {
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
        } catch (t: Throwable) {
            log(pkg, "isInLockTaskMode hook skipped: \${t.message}")
        }
    }

    private fun hookActivityClient(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        // Android 12-16 (API 31-36) routes Activity.startLockTask through android.app.ActivityClient
        val activityClientClass = XposedHelpers.findClassIfExists(
            "android.app.ActivityClient",
            lpparam.classLoader
        ) ?: return

        runCatching {
            XposedBridge.hookAllMethods(
                activityClientClass,
                "startLockTaskModeByToken",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (!isModuleEnabled(pkg)) return
                        markPinned(pkg, "ActivityClient.startLockTaskModeByToken")
                        param.result = null
                    }
                }
            )
            XposedBridge.hookAllMethods(
                activityClientClass,
                "stopLockTaskModeByToken",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (!isModuleEnabled(pkg)) return
                        markUnpinned(pkg, "ActivityClient.stopLockTaskModeByToken")
                        param.result = null
                    }
                }
            )
        }.onFailure {
            log(pkg, "ActivityClient hook error: \${it.message}")
        }
    }

    private fun hookBinderProxies(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        // API 29-36 (Android 10-16): IActivityTaskManager$Stub$Proxy inside app process
        val atmProxy = XposedHelpers.findClassIfExists(
            "android.app.IActivityTaskManager\\$Stub\\$Proxy",
            lpparam.classLoader
        )
        if (atmProxy != null) {
            hookIpcProxyClass(atmProxy, pkg, "IActivityTaskManager")
        }

        // API 21-28 (Android 5-9): IActivityManager$Stub$Proxy inside app process
        val amProxy = XposedHelpers.findClassIfExists(
            "android.app.IActivityManager\\$Stub\\$Proxy",
            lpparam.classLoader
        )
        if (amProxy != null) {
            hookIpcProxyClass(amProxy, pkg, "IActivityManager")
        }
    }

    private fun hookIpcProxyClass(proxyClass: Class<*>, pkg: String, label: String) {
        val startMethods = listOf("startLockTaskModeByToken", "startLockTaskMode")
        val stopMethods = listOf("stopLockTaskModeByToken", "stopLockTaskMode")

        startMethods.forEach { methodName ->
            runCatching {
                XposedBridge.hookAllMethods(
                    proxyClass,
                    methodName,
                    object : XC_MethodHook() {
                        override fun beforeHookedMethod(param: MethodHookParam) {
                            if (!isModuleEnabled(pkg)) return
                            markPinned(pkg, "$label.$methodName")
                            param.result = null
                        }
                    }
                )
            }
        }

        stopMethods.forEach { methodName ->
            runCatching {
                XposedBridge.hookAllMethods(
                    proxyClass,
                    methodName,
                    object : XC_MethodHook() {
                        override fun beforeHookedMethod(param: MethodHookParam) {
                            if (!isModuleEnabled(pkg)) return
                            markUnpinned(pkg, "$label.$methodName")
                            param.result = null
                        }
                    }
                )
            }
        }

        runCatching {
            XposedBridge.hookAllMethods(
                proxyClass,
                "getLockTaskModeState",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldSpoofAsPinned(pkg)) {
                            param.result = ActivityManager.LOCK_TASK_MODE_PINNED
                        }
                    }
                }
            )
        }

        runCatching {
            XposedBridge.hookAllMethods(
                proxyClass,
                "isInLockTaskMode",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (shouldSpoofAsPinned(pkg)) {
                            param.result = true
                        }
                    }
                }
            )
        }
    }

    private fun hookFocusLossSpoof(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName

        // 1. Intercept DecorView.onWindowFocusChanged(false) before Window.Callback delivers it
        //    to any Activity subclass (even subclasses that override without calling super).
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
                            if (!readBool(pkg, "hide_focus_loss", HookConfig.HIDE_FOCUS_LOSS)) return
                            if (param.args.isNotEmpty() && param.args[0] == false) {
                                log(pkg, "Suppressed DecorView.onWindowFocusChanged(false)")
                                param.result = null
                            }
                        }
                    }
                )
            }
        }

        // 2. Intercept Activity.onWindowFocusChanged(false) & Activity.hasWindowFocus()
        runCatching {
            XposedHelpers.findAndHookMethod(
                Activity::class.java,
                "onWindowFocusChanged",
                Boolean::class.javaPrimitiveType,
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (!readBool(pkg, "hide_focus_loss", HookConfig.HIDE_FOCUS_LOSS)) return
                        if (param.args[0] == false) {
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
                        if (readBool(pkg, "hide_focus_loss", HookConfig.HIDE_FOCUS_LOSS)) {
                            param.result = true
                        }
                    }
                }
            )
        }

        // 3. Force View.hasWindowFocus() -> true
        runCatching {
            XposedHelpers.findAndHookMethod(
                View::class.java,
                "hasWindowFocus",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (readBool(pkg, "hide_focus_loss", HookConfig.HIDE_FOCUS_LOSS)) {
                            param.result = true
                        }
                    }
                }
            )
        }

        // 4. Android 10-16 (API 29-36): suppress onTopResumedActivityChanged(false)
        runCatching {
            XposedBridge.hookAllMethods(
                Activity::class.java,
                "performTopResumedActivityChanged",
                object : XC_MethodHook() {
                    override fun beforeHookedMethod(param: MethodHookParam) {
                        if (!readBool(pkg, "hide_focus_loss", HookConfig.HIDE_FOCUS_LOSS)) return
                        if (param.args.isNotEmpty() && param.args[0] == false) {
                            log(pkg, "Suppressed performTopResumedActivityChanged(false)")
                            param.result = null
                        }
                    }
                }
            )
        }

        // 5. Spoof ActivityManager.getMyMemoryState() so process importance stays IMPORTANCE_FOREGROUND
        runCatching {
            XposedHelpers.findAndHookMethod(
                ActivityManager::class.java,
                "getMyMemoryState",
                ActivityManager.RunningAppProcessInfo::class.java,
                object : XC_MethodHook() {
                    override fun afterHookedMethod(param: MethodHookParam) {
                        if (!readBool(pkg, "hide_focus_loss", HookConfig.HIDE_FOCUS_LOSS)) return
                        val outInfo = param.args[0] as? ActivityManager.RunningAppProcessInfo ?: return
                        outInfo.importance = ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
                    }
                }
            )
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

    private fun hookSettingsLockToApp(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        try {
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
        } catch (t: Throwable) {
            log(pkg, "Settings.System hook skipped: \${t.message}")
        }
    }

    private fun hookDevicePolicyPermitted(lpparam: LoadPackageParam) {
        val pkg = lpparam.packageName
        try {
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
        } catch (t: Throwable) {
            log(pkg, "DevicePolicyManager hook skipped: \${t.message}")
        }
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

function generatePrefsManagerKt(config: ModuleConfig, pkg: string): string {
  return `package ${pkg}.prefs

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import ${pkg}.HookConfig

data class GranularHookState(
    val masterEnabled: Boolean = true,
    val alwaysSpoofPinned: Boolean = HookConfig.ALWAYS_SPOOF_PINNED,
    val hideFocusLoss: Boolean = HookConfig.HIDE_FOCUS_LOSS,
    val hideMultiWindowPip: Boolean = HookConfig.HIDE_MULTI_WINDOW_PIP,
    val hookActivityLockTask: Boolean = HookConfig.HOOK_ACTIVITY_LOCK_TASK,
    val hookActivityManagerState: Boolean = HookConfig.HOOK_ACTIVITY_MANAGER_STATE,
    val hookBinderProxies: Boolean = HookConfig.HOOK_BINDER_PROXIES,
    val hookActivityClient: Boolean = HookConfig.HOOK_ACTIVITY_CLIENT,
    val hookSettingsLockToApp: Boolean = HookConfig.HOOK_SETTINGS_LOCK_TO_APP,
    val hookDpmPermitted: Boolean = HookConfig.HOOK_DPM_LOCK_TASK_PERMITTED,
    val debugLogging: Boolean = HookConfig.DEBUG_LOGGING
)

class PrefsManager(context: Context) {

    val isWorldReadableActive: Boolean
    private val prefs: SharedPreferences

    init {
        val (sp, worldOk) = openPrefs(context)
        isWorldReadableActive = worldOk
        prefs = sp
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
            hideMultiWindowPip = prefs.getBoolean(
                "\${prefix}hide_multi_window_pip",
                g?.hideMultiWindowPip ?: HookConfig.HIDE_MULTI_WINDOW_PIP
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
            putBoolean("\${prefix}hide_multi_window_pip", state.hideMultiWindowPip)
            putBoolean("\${prefix}hook_activity_lock_task", state.hookActivityLockTask)
            putBoolean("\${prefix}hook_activity_manager_state", state.hookActivityManagerState)
            putBoolean("\${prefix}hook_binder_proxies", state.hookBinderProxies)
            putBoolean("\${prefix}hook_activity_client", state.hookActivityClient)
            putBoolean("\${prefix}hook_settings_lock_to_app", state.hookSettingsLockToApp)
            putBoolean("\${prefix}hook_dpm_permitted", state.hookDpmPermitted)
            putBoolean("\${prefix}debug_logging", state.debugLogging)
        }.apply()
    }
}
`;
}

function generateMainActivityKt(config: ModuleConfig, pkg: string): string {
  return `package ${pkg}

import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.LayersClear
import androidx.compose.material.icons.rounded.PhonelinkLock
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ${pkg}.prefs.GranularHookState
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

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun PinSpoofControlScreen(prefsManager: PrefsManager) {
    val context = LocalContext.current
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()

    var selectedPkg by remember { mutableStateOf<String?>(null) }
    var selectedLabel by remember { mutableStateOf("Global Defaults") }
    var hookState by remember(selectedPkg) { mutableStateOf(prefsManager.loadState(selectedPkg)) }
    var hasOverride by remember(selectedPkg) {
        mutableStateOf(selectedPkg?.let { prefsManager.hasPerAppOverride(it) } ?: false)
    }
    var showAppPicker by remember { mutableStateOf(false) }

    fun updateState(transform: (GranularHookState) -> GranularHookState) {
        val next = transform(hookState)
        hookState = next
        prefsManager.saveState(selectedPkg, next)
        if (selectedPkg != null) {
            hasOverride = true
        }
    }

    Scaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
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
            // Expressive Scope Selector Card
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
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.Apps,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary
                            )
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = selectedLabel,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Text(
                                    text = selectedPkg ?: "Applies to all apps in LSPosed scope",
                                    style = MaterialTheme.typography.bodySmall,
                                    fontFamily = if (selectedPkg != null) FontFamily.Monospace else FontFamily.Default,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }

                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
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

            // Master LockTask Spoof & Timing Card
            item {
                ElevatedCard(shape = RoundedCornerShape(28.dp)) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
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
                                    text = "Spoof Timing Mode",
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

            // Focus Stealth Card
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
                            title = "Hide Focus Loss & Backgrounding",
                            subtitle = "Drop DecorView.onWindowFocusChanged(false), suppress performTopResumedActivityChanged(false), force hasWindowFocus() & IMPORTANCE_FOREGROUND",
                            checked = hookState.hideFocusLoss,
                            onCheckedChange = { v -> updateState { it.copy(hideFocusLoss = v) } }
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

            // Granular Hook Surface Matrix
            item {
                ElevatedCard(shape = RoundedCornerShape(28.dp)) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text(
                            text = "Granular Hook Surfaces",
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
                            title = "Binder Stub\\$Proxy Interception",
                            subtitle = "Hook IActivityTaskManager & IActivityManager IPC proxies",
                            checked = hookState.hookBinderProxies,
                            onCheckedChange = { v -> updateState { it.copy(hookBinderProxies = v) } }
                        )
                        GranularSwitchItem(
                            title = "ActivityClient Wrapper (Android 12–16)",
                            subtitle = "Hook API 31–36 ActivityClient lock-task token calls",
                            checked = hookState.hookActivityClient,
                            onCheckedChange = { v -> updateState { it.copy(hookActivityClient = v) } }
                        )
                        GranularSwitchItem(
                            title = "Settings.System lock_to_app_enabled",
                            subtitle = "Spoof system screen-pinning toggle as enabled (1)",
                            checked = hookState.hookSettingsLockToApp,
                            onCheckedChange = { v -> updateState { it.copy(hookSettingsLockToApp = v) } }
                        )
                        GranularSwitchItem(
                            title = "DevicePolicyManager.isLockTaskPermitted",
                            subtitle = "Report LockTask permission as granted for scoped app",
                            checked = hookState.hookDpmPermitted,
                            onCheckedChange = { v -> updateState { it.copy(hookDpmPermitted = v) } }
                        )
                        GranularSwitchItem(
                            title = "Verbose LSPosed Logging",
                            subtitle = "Emit XposedBridge.log traces for every intercepted call",
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
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
            ) {
                Text(
                    text = "Select App for Granular Override",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = { Text("Filter by app name or package ID") },
                    singleLine = true,
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(12.dp))
                LazyColumn(
                    modifier = Modifier.height(380.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(filtered, key = { it.packageName }) { app ->
                        Surface(
                            onClick = {
                                selectedPkg = app.packageName
                                selectedLabel = app.label
                                showAppPicker = false
                            },
                            shape = RoundedCornerShape(18.dp),
                            color = if (app.hasOverride) {
                                MaterialTheme.colorScheme.secondaryContainer
                            } else {
                                MaterialTheme.colorScheme.surfaceContainerHigh
                            }
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = app.label,
                                        style = MaterialTheme.typography.bodyMedium,
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
                                    Text(
                                        text = "Custom",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.primary
                                    )
                                }
                            }
                        }
                    }
                }
                Spacer(Modifier.height(16.dp))
            }
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
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = if (checked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
        )
        Column(modifier = Modifier.weight(1f)) {
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
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Column(modifier = Modifier.weight(1f)) {
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

function generateAndroidManifest(config: ModuleConfig, scopes: string[]): string {
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
    ? `
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

${permissions}    <application
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
${scopeMeta}${launcherActivity}
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
  const composeBlock = config.includeMaterialYouUi
    ? `
    buildFeatures {
        compose = true
    }`
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
  return `name: Build ${config.moduleName} APK

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
          SETTINGS_PATH=$(find . -maxdepth 3 -name "settings.gradle.kts" -print -quit)
          if [ -z "$SETTINGS_PATH" ]; then
            echo "Error: settings.gradle.kts not found in repository."
            exit 1
          fi
          GRADLE_DIR=$(dirname "$SETTINGS_PATH")
          echo "Found Gradle build at: $GRADLE_DIR"
          echo "dir=$GRADLE_DIR" >> "$GITHUB_OUTPUT"

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

      - name: Upload APK Artifacts
        uses: actions/upload-artifact@v4
        with:
          name: ${folderName}-apks
          path: \${{ steps.gradle_root.outputs.dir }}/app/build/outputs/apk/**/*.apk
`;
}

function generateReadme(config: ModuleConfig, pkg: string): string {
  return `# ${config.moduleName}

App-scoped Xposed (LSPosed / LSPatch) module targeting **Android 7.0 – Android 16 (API ${config.minSdk}–${config.targetSdk})** that:

1. **Disables System App Pinning**: Swallows \`Activity.startLockTask()\`, \`ActivityClient.startLockTaskModeByToken()\`, and \`IActivityTaskManager$Stub$Proxy\` / \`IActivityManager$Stub$Proxy\` inside the scoped app's ART process before Binder IPC reaches \`system_server\`.
2. **Spoofs Pinned State**: Hooks \`ActivityManager.getLockTaskModeState()\` -> \`LOCK_TASK_MODE_PINNED\` (\`2\`) and \`isInLockTaskMode()\` -> \`true\`.
3. **Hides Focus Loss**: Suppresses \`DecorView.onWindowFocusChanged(false)\`, \`Activity.performTopResumedActivityChanged(false)\`, forces \`hasWindowFocus() -> true\`, and keeps \`ActivityManager.getMyMemoryState()\` at \`IMPORTANCE_FOREGROUND\`.
4. **In-App Material 3 Expressive + Material You UI**: Configure global defaults and per-app granular overrides directly inside the module app using LSPosed \`xposedsharedprefs\`.

## Build APK

### Option A: Android Studio (Recommended)
1. Open this folder in **Android Studio Meerkat (2024.3.1)+** with Android SDK Platform ${config.targetSdk}.
2. Click **Build -> Build Bundle(s) / APK(s) -> Build APK(s)**.

### Option B: Command Line / GitHub Actions CI
- Local CLI (with Gradle 8.11.1 + Android SDK ${config.targetSdk}):
  \`\`\`bash
  gradle assembleRelease
  \`\`\`
- Automated CI: Push this folder to a GitHub repository — \`.github/workflows/build-apk.yml\` will automatically build and publish both debug and release APKs as workflow artifacts.

## LSPosed Setup

1. Install the built APK.
2. Open **LSPosed Manager** -> **Modules** -> **${config.moduleName}**.
3. Enable the module and select **only the target apps** you want to affect.
4. Keep **System Framework (\`android\`) UNCHECKED**.
5. Open the **${config.moduleName}** app to customize granular toggles globally or per app, then force-stop and relaunch your target app.

Package ID: \`${pkg}\`
Entry Class: \`${pkg}.PinSpoofModule\`
`;
}

export function generateProjectFiles(config: ModuleConfig): GeneratedFile[] {
  const pkg = sanitizePackageName(config.packageName);
  const pkgPath = pkg.replace(/\./g, '/');
  const scopes = parseScopes(config.recommendedScopes);

  const files: GeneratedFile[] = [
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
        content: generatePrefsManagerKt(config, pkg),
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
      content: generateAndroidManifest(config, scopes),
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
  anchor.download = `${folderName}-xposed-module.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
