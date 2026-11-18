package us.redcatx.pinspoof

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
            .putLong("$pkg::pin", prefs.getLong("$pkg::pin", 0L) + pinDelta)
            .putLong("$pkg::focus", prefs.getLong("$pkg::focus", 0L) + focusDelta)
            .putLong("$pkg::lifecycle", prefs.getLong("$pkg::lifecycle", 0L) + lifecycleDelta)
            .putLong("$pkg::webview", prefs.getLong("$pkg::webview", 0L) + webviewDelta)
            .putLong("$pkg::cloak", prefs.getLong("$pkg::cloak", 0L) + cloakDelta)
            .putLong("$pkg::ts", now)
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
