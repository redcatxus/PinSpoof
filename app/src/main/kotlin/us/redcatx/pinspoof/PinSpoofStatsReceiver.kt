package us.redcatx.pinspoof

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
