# PinSpoof

App-scoped Xposed (LSPosed / LSPatch) module **and** rootless Morphe Patch Bundle targeting **Android 7.0 – Android 16 (API 24–36)**:

1. **Disables System App Pinning**: Intercepts `Activity.startLockTask()`, `Activity.stopLockTask()`, `ActivityClient`, and Binder `Stub$Proxy` calls locally within the target app's ART process without modifying `system_server`.
2. **Emulates Pinned State**: Reports `ActivityManager.getLockTaskModeState()` -> `LOCK_TASK_MODE_PINNED` (`2`) and `isInLockTaskMode()` -> `true` when active, alongside optional `Settings.System` (`lock_to_app_enabled`) and `DevicePolicyManager.isLockTaskPermitted()` overrides.
3. **Preserves Foreground, Focus & Recents State**:
   - Filters `BroadcastReceiver.onReceive()` for `Intent.ACTION_CLOSE_SYSTEM_DIALOGS` (`recentapps` / `homekey`) via dynamic `registerReceiver` hooking in LSPosed and direct bytecode patching in Morphe.
   - Suppresses `onWindowFocusChanged(false)` across `Activity`, app subclasses, `DecorView`, `Dialog`, and `Window.Callback` listeners, plus API 29+ `Activity.onTopResumedActivityChanged(false)` and `onUserLeaveHint()`.
   - Keeps `hasWindowFocus() -> true` and reports `IMPORTANCE_FOREGROUND` across both `ActivityManager.getMyMemoryState()` and `ActivityManager.getRunningAppProcesses()`.
4. **WebView & Fragment Lifecycle Continuity**:
   - Injects DOM focus/visibility continuity across `onPageStarted`, `onPageFinished`, `onAttachedToWindow`, `setWebViewClient()`, and `loadUrl()`, suppressing `focusout`, `pagehide`, `freeze`, `blur`, `visibilitychange`, and `webkitvisibilitychange` while preserving `document.hidden = false`, `document.visibilityState = "visible"`, and `document.hasFocus() = true`.
   - Maintains `WebView.getWindowVisibility() -> View.VISIBLE`, `dispatchWindowVisibilityChanged`, and API 24+ `onVisibilityAggregated(false) -> true`.
   - Extends `onPause()` / `onStop()` preservation to `androidx.fragment.app.Fragment`, `android.app.Fragment`, `Application.ActivityLifecycleCallbacks`, and `LifecycleRegistry` (`ON_PAUSE` / `ON_STOP`).
5. **Display, Media, Sensor & Environment Compatibility**:
   - **Display & Screenshot Controls**: Removes `FLAG_SECURE` on `Window` and `SurfaceView` so screenshots and screen recording work normally, simulates zeroed pinned `WindowInsets`, and exposes `Display.DEFAULT_DISPLAY` in `DisplayManager` while filtering secondary display callbacks.
   - **Audio & Clipboard Preservation**: Retains `AudioManager` audio focus across interruptions and blocks `ClipboardManager.clearPrimaryClip()` or blank `setPrimaryClip()` clipboard wipes.
   - **Motion Sensor Stabilization**: Provides steady resting readings for accelerometer, gravity, gyroscope, and linear-acceleration events and suppresses `TYPE_SIGNIFICANT_MOTION` triggers for apps that interrupt UI sessions when the device is moved.
   - **Environment, Signature & Integrity Compatibility**: Reports `com.android.vending` as the package installer, filters framework/module packages from `PackageManager` queries, keeps `Thread.getStackTrace()` / `Throwable.getStackTrace()` clean of hook frames, filters `AccessibilityManager` and overlay state checks, and offers optional original signing certificate DER hex preservation (`PackageInfo.signatures` / `SigningInfo`) plus graceful `Task.getException()` handling for Morphe-repackaged APKs.
6. **Material 3 Expressive UI & Live Hook Inspector**:
   - Configure global defaults or inline per-app overrides with one-tap **Light**, **Balanced**, and **Aggressive** presets, throttled live `XSharedPreferences` reloading, JSON profile import/export, real-time hook counters (**Pinning**, **Focus**, **WebView**, **Lifecycle**), and a fullscreen-expandable method-level **Live Hook Event Log** drawer.

## Practical Usage

PinSpoof lets you stay in control of multitasking, screenshots, and system navigation without breaking apps that lock the screen or reset their state during brief interruptions:

- **Keep Android Navigation & Recents Unlocked**: Prevent apps from locking your device into Screen Pinning so the Back button, 3-button/gesture Recents overview, Quick Settings, and notifications remain accessible at all times without disrupting the app's internal layout or navigation state.
- **Multitask Without State Resets, Clipboard Wipes, or Media Pauses**: Open Recents, pull down the notification shade, check a reference note, reply to a message, or use floating/split-screen windows without triggering unwanted WebView playback/timer pauses, audio focus drops, clipboard clears, or full activity teardowns.
- **Take Screenshots & Cast Freely**: Strip restrictive `FLAG_SECURE` flags and secondary-display warnings so you can take personal screenshots, record your screen, or mirror displays without apps blanking out or complaining.
- **No `system_server` Scoping Required**: Unlike legacy pinning modules that hook the Android System Framework (`android`), PinSpoof operates strictly inside the scoped target app process (or directly inside a Morphe-patched APK without root or LSPosed).
- **One-Tap Presets & Live Hook Diagnostics**: Start immediately with the **Balanced** default profile, switch to **Light** (pinning-only) for games or `SurfaceView`-heavy apps, or inspect real-time method hit counts in the Live Hook Event Log to see exactly which hooks an app triggers.

## Option 1: Morphe Patching (No Root / No Xposed)

> **Note:** Morphe re-signs the patched APK. For apps that check signing certificates or client integrity APIs, enable the optional signing certificate DER hex and integrity compatibility toggles in Patching Options, or use **Option 2 (LSPosed)**.

1. Download `PinSpoof-v1.5.0.mpp` from [Releases](https://github.com/redcatxus/PinSpoof/releases) (or build locally in `morphe-patches/` via `gradle :patches:buildAndroid :patches:generatePatchesList`).
2. Import `PinSpoof-v1.5.0.mpp` into **Morphe Manager** (Expert Mode) or **Morphe Desktop CLI**.
3. Pick any target APK and open **Patching Options** on the **PinSpoof** patch to customize your preset or individual toggles (pinning, Recents broadcasts, window focus, WebView JS/visibility, lifecycle preservation, multi-window/PiP, display/screenshot/audio/clipboard controls, sensor stabilization, and environment/signature compatibility).
4. Patch and install the modified APK.

## Option 2: LSPosed Setup

1. Install **`PinSpoof-v1.5.0.apk`** (`versionCode: 8`) from [Releases](https://github.com/redcatxus/PinSpoof/releases).
2. Open **LSPosed Manager** -> **Modules** -> **PinSpoof**.
3. Enable the module and select **only the target apps** you want to affect (keep **System Framework (`android`) UNCHECKED**).
4. Open the **PinSpoof** companion app to select a preset (**Light**, **Balanced**, **Aggressive**) or customize granular toggles globally or per app, open the **Morphe Patch Options** checklist to mirror toggles into Morphe Manager, then force-stop and relaunch your target app.

- **Package ID**: `us.redcatx.pinspoof`
- **Entry Class**: `us.redcatx.pinspoof.PinSpoofModule`

## Disclaimer & Support

This project was created with the assistance of Artificial Intelligence and is licensed under **GPL-3.0**. This software is provided **"as-is"**, without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and non-infringement.

**No user support is provided.** Do not expect assistance with troubleshooting, app compatibility, or custom configurations—fork the repository and implement your own changes if needed. Use responsibly and solely on devices and software where you are authorized to do so.
