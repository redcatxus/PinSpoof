package us.redcatx.pinspoof.prefs

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import us.redcatx.pinspoof.HookConfig

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

    fun toMorpheOptionsPairs(): List<Pair<String, String>> {
        val timing = if (alwaysSpoofPinned) "always" else "reactive"
        val items = mutableListOf(
            "spoofTiming" to timing,
            "hookActivityLockTask" to hookActivityLockTask.toString(),
            "hookActivityManagerState" to hookActivityManagerState.toString(),
            "hookBinderProxies" to hookBinderProxies.toString(),
            "hideFocusLoss" to hideFocusLoss.toString(),
            "hideWebViewVisibility" to hideWebViewVisibility.toString(),
            "hideLifecycleLoss" to hideLifecycleLoss.toString(),
            "hideMultiWindowAndPip" to hideMultiWindowPip.toString(),
            "spoofPinnedInsets" to spoofPinnedInsets.toString(),
            "stripFlagSecure" to stripFlagSecure.toString(),
            "bypassVirtualDisplays" to bypassVirtualDisplays.toString(),
            "unblockClipboard" to unblockClipboard.toString(),
            "hideAccessibilityAndOverlays" to hideAccessibilityOverlays.toString(),
            "retainAudioFocus" to retainAudioFocus.toString(),
            "cloakPackagesAndInstaller" to cloakPackagesInstaller.toString(),
            "sanitizeStackTraces" to sanitizeStackTraces.toString(),
            "spoofMotionSensors" to spoofMotionSensors.toString(),
            "spoofPackageSignature" to spoofPackageSignature.toString()
        )
        val cleanHex = spoofSignatureHex.replace(":", "").replace(" ", "").trim()
        if (spoofPackageSignature && cleanHex.isNotEmpty()) {
            items += "originalSignatureHex" to cleanHex
        }
        items += listOf(
            "softFailIntegrityChecks" to softFailIntegrity.toString(),
            "hookSettingsLockToApp" to hookSettingsLockToApp.toString(),
            "hookDevicePolicyPermitted" to hookDpmPermitted.toString(),
            "debugLogging" to debugLogging.toString()
        )
        return items
    }

    fun toMorpheCliFlags(): String =
        toMorpheOptionsPairs().joinToString(" ") { (k, v) ->
            if (k == "originalSignatureHex") "-O$k=\"$v\"" else "-O$k=$v"
        }

    fun toMorpheChecklist(): List<Pair<String, String>> = listOf(
        "Spoof Timing Mode" to if (alwaysSpoofPinned) "Always Pinned (from launch)" else "Reactive (after startLockTask)",
        "Disable Pinning (startLockTask / stopLockTask)" to if (hookActivityLockTask) "ON" else "OFF",
        "Spoof ActivityManager Pin State" to if (hookActivityManagerState) "ON" else "OFF",
        "Binder Stub\$Proxy LockTask Interception" to if (hookBinderProxies) "ON" else "OFF",
        "Window Focus Spoofing (Safe)" to if (hideFocusLoss) "ON" else "OFF",
        "WebView Visibility, JS & Pause Stealth" to if (hideWebViewVisibility) "ON" else "OFF",
        "Suppress onPause / onStop" to if (hideLifecycleLoss) "ON" else "OFF",
        "Hide Multi-Window & Picture-in-Picture" to if (hideMultiWindowPip) "ON" else "OFF",
        "Simulate Pinned Window Insets" to if (spoofPinnedInsets) "ON" else "OFF",
        "Strip FLAG_SECURE" to if (stripFlagSecure) "ON" else "OFF",
        "Virtual Display & Screen Sharing Bypass" to if (bypassVirtualDisplays) "ON" else "OFF",
        "Unblock Clipboard Clear" to if (unblockClipboard) "ON" else "OFF",
        "Hide Accessibility & Overlay Checks" to if (hideAccessibilityOverlays) "ON" else "OFF",
        "Retain Audio Focus" to if (retainAudioFocus) "ON" else "OFF",
        "Cloak Packages & Play Store Installer" to if (cloakPackagesInstaller) "ON" else "OFF",
        "Sanitize Stack Traces" to if (sanitizeStackTraces) "ON" else "OFF",
        "Spoof Motion Sensors (Stationary)" to if (spoofMotionSensors) "ON" else "OFF",
        "Static Package Signature Spoof" to if (spoofPackageSignature) "ON" else "OFF",
        "Original Certificate DER Hex" to spoofSignatureHex.trim().ifEmpty { "(empty)" },
        "Play Integrity / SafetyNet Soft-Fail" to if (softFailIntegrity) "ON" else "OFF",
        "Spoof Settings.System lock_to_app_enabled" to if (hookSettingsLockToApp) "ON" else "OFF",
        "Spoof DevicePolicyManager.isLockTaskPermitted" to if (hookDpmPermitted) "ON" else "OFF",
        "Verbose Logcat Debug Logging" to if (debugLogging) "ON" else "OFF"
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
        prefs.getBoolean("${packageName}::override", false)

    fun setPerAppOverride(packageName: String, enabled: Boolean) {
        prefs.edit().putBoolean("${packageName}::override", enabled).apply()
    }

    fun loadState(targetPackage: String?): GranularHookState {
        val prefix = if (targetPackage != null && hasPerAppOverride(targetPackage)) {
            "$targetPackage::"
        } else {
            "global::"
        }
        val g = if (prefix != "global::") loadState(null) else null
        return GranularHookState(
            masterEnabled = prefs.getBoolean("${prefix}master_enabled", g?.masterEnabled ?: true),
            alwaysSpoofPinned = prefs.getBoolean(
                "${prefix}always_spoof_pinned",
                g?.alwaysSpoofPinned ?: HookConfig.ALWAYS_SPOOF_PINNED
            ),
            hideFocusLoss = prefs.getBoolean(
                "${prefix}hide_focus_loss",
                g?.hideFocusLoss ?: HookConfig.HIDE_FOCUS_LOSS
            ),
            hideWebViewVisibility = prefs.getBoolean(
                "${prefix}hide_webview_visibility",
                g?.hideWebViewVisibility ?: HookConfig.HIDE_WEBVIEW_VISIBILITY
            ),
            hideLifecycleLoss = prefs.getBoolean(
                "${prefix}hide_lifecycle_loss",
                g?.hideLifecycleLoss ?: HookConfig.HIDE_LIFECYCLE_LOSS
            ),
            hideMultiWindowPip = prefs.getBoolean(
                "${prefix}hide_multi_window_pip",
                g?.hideMultiWindowPip ?: HookConfig.HIDE_MULTI_WINDOW_PIP
            ),
            spoofPinnedInsets = prefs.getBoolean(
                "${prefix}spoof_pinned_insets",
                g?.spoofPinnedInsets ?: HookConfig.SPOOF_PINNED_INSETS
            ),
            stripFlagSecure = prefs.getBoolean(
                "${prefix}strip_flag_secure",
                g?.stripFlagSecure ?: HookConfig.STRIP_FLAG_SECURE
            ),
            hideAccessibilityOverlays = prefs.getBoolean(
                "${prefix}hide_accessibility_overlays",
                g?.hideAccessibilityOverlays ?: HookConfig.HIDE_ACCESSIBILITY_OVERLAYS
            ),
            retainAudioFocus = prefs.getBoolean(
                "${prefix}retain_audio_focus",
                g?.retainAudioFocus ?: HookConfig.RETAIN_AUDIO_FOCUS
            ),
            cloakPackagesInstaller = prefs.getBoolean(
                "${prefix}cloak_packages_installer",
                g?.cloakPackagesInstaller ?: HookConfig.CLOAK_PACKAGES_INSTALLER
            ),
            sanitizeStackTraces = prefs.getBoolean(
                "${prefix}sanitize_stack_traces",
                g?.sanitizeStackTraces ?: HookConfig.SANITIZE_STACK_TRACES
            ),
            spoofMotionSensors = prefs.getBoolean(
                "${prefix}spoof_motion_sensors",
                g?.spoofMotionSensors ?: HookConfig.SPOOF_MOTION_SENSORS
            ),
            bypassVirtualDisplays = prefs.getBoolean(
                "${prefix}bypass_virtual_displays",
                g?.bypassVirtualDisplays ?: HookConfig.BYPASS_VIRTUAL_DISPLAYS
            ),
            unblockClipboard = prefs.getBoolean(
                "${prefix}unblock_clipboard",
                g?.unblockClipboard ?: HookConfig.UNBLOCK_CLIPBOARD
            ),
            spoofPackageSignature = prefs.getBoolean(
                "${prefix}spoof_package_signature",
                g?.spoofPackageSignature ?: HookConfig.SPOOF_PACKAGE_SIGNATURE
            ),
            spoofSignatureHex = prefs.getString(
                "${prefix}spoof_signature_hex",
                g?.spoofSignatureHex ?: HookConfig.SPOOF_SIGNATURE_HEX
            ) ?: HookConfig.SPOOF_SIGNATURE_HEX,
            softFailIntegrity = prefs.getBoolean(
                "${prefix}soft_fail_integrity",
                g?.softFailIntegrity ?: HookConfig.SOFT_FAIL_INTEGRITY
            ),
            hookActivityLockTask = prefs.getBoolean(
                "${prefix}hook_activity_lock_task",
                g?.hookActivityLockTask ?: HookConfig.HOOK_ACTIVITY_LOCK_TASK
            ),
            hookActivityManagerState = prefs.getBoolean(
                "${prefix}hook_activity_manager_state",
                g?.hookActivityManagerState ?: HookConfig.HOOK_ACTIVITY_MANAGER_STATE
            ),
            hookBinderProxies = prefs.getBoolean(
                "${prefix}hook_binder_proxies",
                g?.hookBinderProxies ?: HookConfig.HOOK_BINDER_PROXIES
            ),
            hookActivityClient = prefs.getBoolean(
                "${prefix}hook_activity_client",
                g?.hookActivityClient ?: HookConfig.HOOK_ACTIVITY_CLIENT
            ),
            hookSettingsLockToApp = prefs.getBoolean(
                "${prefix}hook_settings_lock_to_app",
                g?.hookSettingsLockToApp ?: HookConfig.HOOK_SETTINGS_LOCK_TO_APP
            ),
            hookDpmPermitted = prefs.getBoolean(
                "${prefix}hook_dpm_permitted",
                g?.hookDpmPermitted ?: HookConfig.HOOK_DPM_LOCK_TASK_PERMITTED
            ),
            debugLogging = prefs.getBoolean(
                "${prefix}debug_logging",
                g?.debugLogging ?: HookConfig.DEBUG_LOGGING
            )
        )
    }

    fun saveState(targetPackage: String?, state: GranularHookState) {
        val prefix = if (targetPackage != null) "$targetPackage::" else "global::"
        prefs.edit().apply {
            if (targetPackage != null) {
                putBoolean("${targetPackage}::override", true)
            }
            putBoolean("${prefix}master_enabled", state.masterEnabled)
            putBoolean("${prefix}always_spoof_pinned", state.alwaysSpoofPinned)
            putBoolean("${prefix}hide_focus_loss", state.hideFocusLoss)
            putBoolean("${prefix}hide_webview_visibility", state.hideWebViewVisibility)
            putBoolean("${prefix}hide_lifecycle_loss", state.hideLifecycleLoss)
            putBoolean("${prefix}hide_multi_window_pip", state.hideMultiWindowPip)
            putBoolean("${prefix}spoof_pinned_insets", state.spoofPinnedInsets)
            putBoolean("${prefix}strip_flag_secure", state.stripFlagSecure)
            putBoolean("${prefix}hide_accessibility_overlays", state.hideAccessibilityOverlays)
            putBoolean("${prefix}retain_audio_focus", state.retainAudioFocus)
            putBoolean("${prefix}cloak_packages_installer", state.cloakPackagesInstaller)
            putBoolean("${prefix}sanitize_stack_traces", state.sanitizeStackTraces)
            putBoolean("${prefix}spoof_motion_sensors", state.spoofMotionSensors)
            putBoolean("${prefix}bypass_virtual_displays", state.bypassVirtualDisplays)
            putBoolean("${prefix}unblock_clipboard", state.unblockClipboard)
            putBoolean("${prefix}spoof_package_signature", state.spoofPackageSignature)
            putString("${prefix}spoof_signature_hex", state.spoofSignatureHex.trim())
            putBoolean("${prefix}soft_fail_integrity", state.softFailIntegrity)
            putBoolean("${prefix}hook_activity_lock_task", state.hookActivityLockTask)
            putBoolean("${prefix}hook_activity_manager_state", state.hookActivityManagerState)
            putBoolean("${prefix}hook_binder_proxies", state.hookBinderProxies)
            putBoolean("${prefix}hook_activity_client", state.hookActivityClient)
            putBoolean("${prefix}hook_settings_lock_to_app", state.hookSettingsLockToApp)
            putBoolean("${prefix}hook_dpm_permitted", state.hookDpmPermitted)
            putBoolean("${prefix}debug_logging", state.debugLogging)
        }.apply()
    }

    fun loadStats(targetPackage: String?): HookStats {
        val key = targetPackage ?: "__all__"
        return HookStats(
            pinBlocked = statsPrefs.getLong("$key::pin", 0L),
            focusHidden = statsPrefs.getLong("$key::focus", 0L),
            lifecycleHidden = statsPrefs.getLong("$key::lifecycle", 0L),
            webviewSpoofed = statsPrefs.getLong("$key::webview", 0L),
            cloakBypassed = statsPrefs.getLong("$key::cloak", 0L),
            lastUpdatedMs = statsPrefs.getLong("$key::ts", 0L)
        )
    }

    fun getPackageHitTotal(packageName: String): Long =
        statsPrefs.getLong("$packageName::pin", 0L) +
            statsPrefs.getLong("$packageName::focus", 0L) +
            statsPrefs.getLong("$packageName::lifecycle", 0L) +
            statsPrefs.getLong("$packageName::webview", 0L) +
            statsPrefs.getLong("$packageName::cloak", 0L)

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
                remove("$targetPackage::pin")
                remove("$targetPackage::focus")
                remove("$targetPackage::lifecycle")
                remove("$targetPackage::webview")
                remove("$targetPackage::cloak")
                remove("$targetPackage::ts")
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
