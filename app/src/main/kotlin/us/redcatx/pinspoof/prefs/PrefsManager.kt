package us.redcatx.pinspoof.prefs

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject
import us.redcatx.pinspoof.HookConfig

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
