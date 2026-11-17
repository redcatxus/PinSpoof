# PinSpoof

App-scoped Xposed (LSPosed / LSPatch) module **and** rootless Morphe Patch Bundle targeting **Android 7.0 – Android 16 (API 24–36)**:

1. **Disables System App Pinning**: Intercepts `Activity.startLockTask()`, `Activity.stopLockTask()`, `ActivityClient`, and Binder `Stub$Proxy` calls inside the target app's ART process before IPC reaches `system_server`.
2. **Spoofs Pinned State**: Spoofs `ActivityManager.getLockTaskModeState()` -> `LOCK_TASK_MODE_PINNED` (`2`) and `isInLockTaskMode()` -> `true`.
3. **Hides Focus & Recents Loss**: Suppresses `View.dispatchWindowFocusChanged(false)`, `ViewTreeObserver`, `DecorView`, `WebView.onWindowVisibilityChanged`, `WebView.onPause()`, `Activity.performTopResumedActivityChanged(false)`, `onUserLeaveHint()`, `onPause()` / `onStop()`, `Application.ActivityLifecycleCallbacks`, `LifecycleRegistry` (`ON_PAUSE`/`ON_STOP`), forces `hasWindowFocus() -> true`, and keeps `ActivityManager.getMyMemoryState()` at `IMPORTANCE_FOREGROUND`.
4. **Accessible Anywhere**:
   - **Morphe Patching (No Root / No Xposed)**: All granular controls are exposed directly as **Morphe Patching Options** inside `morphe-patches/` (`.mpp` bundle works universally on any APK).
   - **LSPosed Xposed + Material 3 Expressive UI**: Configure global defaults and per-app granular overrides inside the module APK via `xposedsharedprefs`.

## Practical Usage

PinSpoof lets you stay in control of multitasking and system navigation without breaking apps that insist on locking the screen or reacting aggressively to brief interruptions:

- **Keep Android Navigation & Recents Unlocked**: Stop apps from trapping your device in Screen Pinning so the Back button, Recents overview, gesture navigation, Quick Settings, and notifications always remain usable while the app believes pinning succeeded.
- **Multitask Without Focus-Loss Nagging or Resets**: Open Recents, switch briefly to a calculator/notes/translator app, pull down the notification shade, or open floating/split-screen windows without triggering focus-lost overlays, forced UI lockouts, WebView playback/timer pauses, or state resets.
- **No `system_server` Scoping Required**: Unlike legacy pinning hooks that hook the Android System Framework (`android`), PinSpoof hooks purely inside the scoped target app process (or directly inside a Morphe-patched APK without root or LSPosed).
- **Per-App or Patch-Time Granularity**: Leave pinning disabled across all scoped apps with **Reactive** mode (spoofs pinned only after `startLockTask()` is invoked) or force **Always Pinned**, and toggle individual lifecycle, WebView, multi-window, or settings hooks independently.

## Option 1: Morphe Patching (No Root / No Xposed)

1. Download the `PinSpoof-morphe-patches` artifact (`patches-*.mpp`) built by `.github/workflows/build-apk.yml`, or build locally in `morphe-patches/`:
   ```bash
   gradle :patches:buildAndroid :patches:generatePatchesList
   ```
2. Import `patches-*.mpp` into **Morphe Manager** (Expert Mode) or **Morphe Desktop CLI**.
3. Pick any target APK, open **Patching Options** on the **PinSpoof** patch to toggle:
   - `Spoof Timing Mode` (`reactive` vs `always`)
   - `Disable Pinning (startLockTask / stopLockTask)`
   - `Spoof ActivityManager Pin State`
   - `Hide Window Focus Loss & WebView Visibility`
   - `Suppress onPause / onStop / Recents Leave`
   - `Hide Multi-Window & Picture-in-Picture`
   - `Spoof Settings.System lock_to_app_enabled` & `DevicePolicyManager.isLockTaskPermitted`
   - `Verbose Logcat Debug Logging`
4. Patch and install the modified APK.

## Option 2: LSPosed Setup

1. Install the built APK (`PinSpoof-apks`).
2. Open **LSPosed Manager** -> **Modules** -> **PinSpoof**.
3. Enable the module and select **only the target apps** you want to affect (keep **System Framework (`android`) UNCHECKED**).
4. Open the **PinSpoof** app to customize granular toggles globally or per app, then force-stop and relaunch your target app.

Package ID: `us.redcatx.pinspoof`
Entry Class: `us.redcatx.pinspoof.PinSpoofModule`

## Disclaimer

This software is provided **"as-is"**, without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and non-infringement. Use it responsibly and solely on devices and software where you are authorized to do so.
