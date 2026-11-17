package us.redcatx.pinspoof

/**
 * Compile-time default hook configuration generated for PinSpoof.
 * When the Material You settings UI is enabled, runtime overrides from
 * XSharedPreferences take precedence per-app or globally.
 * Never requires scoping to system_server ("android").
 */
object HookConfig {
    const val MODULE_TAG = "PinSpoof"
    const val MODULE_PKG = "us.redcatx.pinspoof"
    const val PREFS_NAME = "pinspoof_prefs"

    const val ALWAYS_SPOOF_PINNED = false
    const val HOOK_ACTIVITY_LOCK_TASK = true
    const val HOOK_ACTIVITY_MANAGER_STATE = true
    const val HOOK_BINDER_PROXIES = true
    const val HOOK_ACTIVITY_CLIENT = true
    const val HOOK_SETTINGS_LOCK_TO_APP = false
    const val HOOK_DPM_LOCK_TASK_PERMITTED = false
    const val HIDE_FOCUS_LOSS = true
    const val HIDE_MULTI_WINDOW_PIP = true
    const val DEBUG_LOGGING = true
}
