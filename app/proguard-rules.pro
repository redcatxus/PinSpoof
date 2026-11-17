# Keep the Xposed entry class referenced by assets/xposed_init
-keep class us.redcatx.pinspoof.PinSpoofModule { *; }
-keep class us.redcatx.pinspoof.HookConfig { *; }
-keep class us.redcatx.pinspoof.prefs.** { *; }
-dontwarn de.robv.android.xposed.**
