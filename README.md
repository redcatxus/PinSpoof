# PinSpoof

App-scoped Xposed (LSPosed / LSPatch) module **and** rootless Morphe Patch Bundle targeting **Android 7.0 – Android 16 (API 24–36)**:

1. **Disables System App Pinning**: Intercepts `Activity.startLockTask()`, `Activity.stopLockTask()`, `ActivityClient`, and Binder `Stub$Proxy` calls locally within the target app's ART process without modifying `system_server`.
2. **Emulates Pinned State**: Reports `ActivityManager.getLockTaskModeState()` -> `LOCK_TASK_MODE_PINNED` (`2`) and `isInLockTaskMode()` -> `true` when active, alongside optional `Settings.System` (`lock_to_app_enabled`) and `DevicePolicyManager.isLockTaskPermitted()` overrides.
3. **Preserves Foreground & Focus State**: Suppresses `View.dispatchWindowFocusChanged(false)`, `ViewTreeObserver`, `DecorView`, `WebView.onWindowVisibilityChanged`, `WebView.onPause()`, `Activity.performTopResumedActivityChanged(false)`, `onUserLeaveHint()`, `onPause()` / `onStop()`, `Application.ActivityLifecycleCallbacks`, `LifecycleRegistry` (`ON_PAUSE`/`ON_STOP`), maintains `hasWindowFocus() -> true`, and keeps `ActivityManager.getMyMemoryState()` at `IMPORTANCE_FOREGROUND`.
4. **Accessible Anywhere**:
   - **Morphe Patching (No Root / No Xposed)**: All 9 granular controls are exposed directly as **Morphe Patching Options** inside `morphe-patches/` (`.mpp` bundle works universally across APKs).
   - **LSPosed Xposed + Material 3 Expressive UI**: Configure global defaults and per-app granular overrides inside the module APK via `xposedsharedprefs`.

## Practical Usage

PinSpoof lets you stay in control of multitasking and system navigation without breaking apps that lock the screen or reset their state during brief interruptions:

- **Keep Android Navigation & Recents Unlocked**: Prevent apps from locking your device into Screen Pinning so the Back button, Recents overview, gesture navigation, Quick Settings, and notifications always remain usable without disrupting the app's internal layout or navigation state.
- **Multitask Without State Resets or Media Pauses**: Open Recents, pull down the notification shade, check a reference note, reply to a message, or use floating/split-screen windows without triggering unwanted WebView playback/timer pauses, aggressive activity teardowns, or full state resets.
- **No `system_server` Scoping Required**: Unlike legacy pinning modules that target the Android System Framework (`android`), PinSpoof operates strictly inside the scoped target app process (or directly inside a Morphe-patched APK without root or LSPosed).
- **Per-App or Patch-Time Granularity**: Leave pinning disabled across all scoped apps with **Reactive** mode (emulates pinned state only after `startLockTask()` is invoked) or force **Always Pinned (from launch)**, and toggle individual lifecycle, WebView, multi-window, or system-setting hooks independently.

## Option 1: Morphe Patching (No Root / No Xposed)

> **Note:** Morphe re-signs the patched APK. Apps that enforce signature verification or Play Integrity checks require **Option 2 (LSPosed)**.

1. Download the `PinSpoof-morphe-patches` artifact (`patches-*.mpp`) built by `.github/workflows/build-apk.yml`, or build locally in `morphe-patches/`:
   ```bash
   gradle :patches:buildAndroid :patches:generatePatchesList
   ```
2. Import `patches-*.mpp` into **Morphe Manager** (Expert Mode) or **Morphe Desktop CLI**.
3. Pick any target APK, open **Patching Options** on the **PinSpoof** patch to configure all 9 options:
   - **`Spoof Timing Mode`**: Choose whether LockTask state is reported only after `startLockTask()` is invoked (`Reactive`, recommended) or `Always Pinned (from launch)`.
   - **`Disable Pinning (startLockTask / stopLockTask)`**: Intercepts `Activity.startLockTask()` and `stopLockTask()` calls so Android never enters system Screen Pinning.
   - **`Spoof ActivityManager Pin State`**: Returns `LOCK_TASK_MODE_PINNED` (`2`) for `getLockTaskModeState()` and `true` for `isInLockTaskMode()`.
   - **`Hide Window Focus Loss & WebView Visibility`**: Blocks `onWindowFocusChanged(false)`, coerces `WebView`/`View` window visibility to `VISIBLE`, and maintains `hasWindowFocus()` and `IMPORTANCE_FOREGROUND`.
   - **`Suppress onPause / onStop / Recents Leave`**: Suppresses app `onUserLeaveHint()`, `onPause()`, `onStop()`, `ActivityLifecycleCallbacks`, `WebView.onPause()`, and `LifecycleRegistry` `ON_PAUSE`/`ON_STOP` dispatches.
   - **`Hide Multi-Window & Picture-in-Picture`**: Returns `false` for `Activity.isInMultiWindowMode()` and `isInPictureInPictureMode()`.
   - **`Spoof Settings.System lock_to_app_enabled`**: Returns `1` when the target app queries `Settings.System.lock_to_app_enabled`.
   - **`Spoof DevicePolicyManager.isLockTaskPermitted`**: Returns `true` when the target app checks `DevicePolicyManager.isLockTaskPermitted()`.
   - **`Verbose Logcat Debug Logging`**: Emits `Log.d("PinSpoof", ...)` traces when patched hooks intercept pinning or focus events.
4. Patch and install the modified APK.

## Option 2: LSPosed Setup

1. Install the built APK (`PinSpoof-apks`).
2. Open **LSPosed Manager** -> **Modules** -> **PinSpoof**.
3. Enable the module and select **only the target apps** you want to affect (keep **System Framework (`android`) UNCHECKED**).
4. Open the **PinSpoof** app to customize granular toggles globally or per app, then force-stop and relaunch your target app.

- **Package ID**: `us.redcatx.pinspoof`
- **Entry Class**: `us.redcatx.pinspoof.PinSpoofModule`

## Disclaimer & Support

This project was created with the assistance of Artificial Intelligence and is licensed under **GPL-3.0**. This software is provided **"as-is"**, without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and non-infringement.

**No user support is provided.** Do not expect assistance with troubleshooting, app compatibility, or custom configurations—fork the repository and implement your own changes if needed. Use responsibly and solely on devices and software where you are authorized to do so.
