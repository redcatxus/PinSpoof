package us.redcatx.pinspoof

/**
 * Compile-time default hook configuration generated for PinSpoof v1.3.0.
 * When the Material You settings UI is enabled, runtime overrides from
 * XSharedPreferences take precedence per-app or globally.
 * Never requires scoping to system_server ("android").
 */
object HookConfig {
    const val MODULE_TAG = "PinSpoof"
    const val VERSION_NAME = "1.3.0"
    const val MODULE_PKG = "us.redcatx.pinspoof"
    const val PREFS_NAME = "pinspoof_prefs"
    const val STATS_PREFS_NAME = "pinspoof_stats"
    const val STATS_ACTION = "us.redcatx.pinspoof.ACTION_HOOK_STATS"

    const val ALWAYS_SPOOF_PINNED = false
    const val HOOK_ACTIVITY_LOCK_TASK = true
    const val HOOK_ACTIVITY_MANAGER_STATE = true
    const val HOOK_BINDER_PROXIES = false
    const val HOOK_ACTIVITY_CLIENT = true
    const val HOOK_SETTINGS_LOCK_TO_APP = false
    const val HOOK_DPM_LOCK_TASK_PERMITTED = false
    const val HIDE_FOCUS_LOSS = true
    const val HIDE_WEBVIEW_VISIBILITY = false
    const val HIDE_LIFECYCLE_LOSS = false
    const val HIDE_MULTI_WINDOW_PIP = true
    const val SPOOF_PINNED_INSETS = false
    const val STRIP_FLAG_SECURE = false
    const val HIDE_ACCESSIBILITY_OVERLAYS = false
    const val RETAIN_AUDIO_FOCUS = false
    const val CLOAK_PACKAGES_INSTALLER = false
    const val SANITIZE_STACK_TRACES = false
    const val SPOOF_MOTION_SENSORS = false
    const val BYPASS_VIRTUAL_DISPLAYS = false
    const val UNBLOCK_CLIPBOARD = false
    const val SPOOF_PACKAGE_SIGNATURE = false
    const val SPOOF_SIGNATURE_HEX = ""
    const val SOFT_FAIL_INTEGRITY = false
    const val DEBUG_LOGGING = false
}
