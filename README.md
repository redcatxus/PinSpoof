# PinSpoof

App-scoped Xposed (LSPosed / LSPatch) module **and** rootless Morphe Patch Bundle (`PinSpoof-v1.3.1.apk` / `PinSpoof-v1.3.1.mpp`) targeting **Android 7.0 – Android 16 (API 24–36)**:

1. **Disables System App Pinning**: Intercepts `Activity.startLockTask()`, `Activity.stopLockTask()`, `ActivityClient`, and optional Binder `Stub$Proxy` calls (with dynamic OEM-safe method scanning) locally within the target app's ART process without modifying `system_server`.
2. **Emulates Pinned State**: Reports `ActivityManager.getLockTaskModeState()` -> `LOCK_TASK_MODE_PINNED` (`2`) and `isInLockTaskMode()` -> `true` in safe **Reactive** mode by default (or optional **Always Pinned**), alongside optional `Settings.System` (`lock_to_app_enabled`) and `DevicePolicyManager.isLockTaskPermitted()` overrides.
3. **Preserves Foreground, WebView & Display State**:
   - **Window Focus Spoofing (Safe Default)**: Drops `View.dispatchWindowFocusChanged(false)`, `ViewTreeObserver`, `DecorView`, `Activity.performTopResumedActivityChanged(false)`, safe `onUserLeaveHint()`, maintains `hasWindowFocus() -> true`, and keeps `ActivityManager.getMyMemoryState()` at `IMPORTANCE_FOREGROUND`.
   - **WebView Visibility, JS & Pause Stealth (Opt-in)**: Forces `WebView` visibility `VISIBLE`, blocks `WebView.onPause()` / `pauseTimers()`, and injects DOM stealth (`document.hidden = false`, `document.visibilityState = "visible"`, `document.hasFocus = () => true`, `visibilitychange` / `blur` suppression).
   - **Lifecycle Suppression (Advanced Opt-in)**: Off by default to prevent `SurfaceView` / `TextureView` graphics stalls when resuming from Recents; optionally blocks `onPause()`, `onStop()`, `Application.ActivityLifecycleCallbacks`, and `LifecycleRegistry` (`ON_PAUSE`/`ON_STOP`).
   - **Display, Media & UI Bypass**: Simulate zeroed pinned `WindowInsets`, strip `FLAG_SECURE`, expose only `Display.DEFAULT_DISPLAY` for virtual/screen-sharing bypass, unblock `ClipboardManager.clearPrimaryClip()`, hide `AccessibilityManager` / overlay checks, and retain `AudioManager` focus.
4. **Anti-Detection & Integrity Cloaking**:
   - **Package & Installer Cloaking**: Report `com.android.vending` as installer and hide Xposed / LSPosed / Morphe manager packages from `PackageManager`.
   - **Stack Trace Sanitization & Motion Sensors**: Strip hook frames from `Thread` / `Throwable.getStackTrace()` and clamp accelerometer/gyroscope readings to resting desk values.
   - **Signature & Play Integrity Handling**: Optional `PackageInfo.signatures` / `SigningInfo` replacement via Certificate DER Hex and soft-fail clearing on Integrity / SafetyNet `Task.getException()`.
5. **Accessible Anywhere**:
   - **Morphe Patching (No Root / No Xposed)**: All controls are exposed directly as **Morphe Patching Options** inside `PinSpoof-v1.3.1.mpp` (universal patch, works on any APK).
   - **LSPosed Xposed + Material 3 Expressive UI**: Inline expandable per-app rules & presets (`Light`, `Balanced`, `Aggressive`), JSON export/import, and a tappable **Live Hook Event Counter** & method event log drawer via `xposedsharedprefs`.

## Practical Usage

PinSpoof lets you stay in control of multitasking and system navigation without breaking apps that lock the screen or reset their state during brief interruptions:

- **Keep Android Navigation & Recents Unlocked**: Prevent apps from locking your device into Screen Pinning so the Back button, Recents overview, gesture navigation, Quick Settings, and notifications always remain usable without disrupting the app's internal layout or navigation state.
- **Multitask Without State Resets or Media Pauses**: Open Recents, pull down the notification shade, check a reference note, reply to a message, or use floating/split-screen windows without triggering unwanted WebView playback/timer pauses, aggressive activity teardowns, clipboard wipes, or full state resets.
- **No `system_server` Scoping Required**: Unlike legacy pinning modules that target the Android System Framework (`android`), PinSpoof operates strictly inside the scoped target app process (or directly inside a Morphe-patched APK without root or LSPosed).
- **Per-App Presets & Patch-Time Granularity**: Leave pinning disabled across all scoped apps with **Reactive** mode (emulates pinned state only after `startLockTask()` is invoked) or assign **Light**, **Balanced**, or **Aggressive** profiles per app directly inside the app picker.

## Option 1: Morphe Patching (No Root / No Xposed)

> **Note:** Morphe re-signs the patched APK. Apps that enforce signature verification can use **Static Package Signature Spoof** with your original certificate DER hex, or use **Option 2 (LSPosed)**.

1. Download the `PinSpoof-morphe-patches` artifact (`PinSpoof-v1.3.1.mpp`) built by `.github/workflows/build-apk.yml`, or build locally in `morphe-patches/`:
   ```bash
   gradle :patches:buildAndroid :patches:generatePatchesList
   ```
2. Import `PinSpoof-v1.3.1.mpp` into **Morphe Manager** (Expert Mode) or **Morphe Desktop CLI**.
3. Pick any target APK, open **Patching Options** on the **PinSpoof** universal patch to configure:
   - **`Spoof Timing Mode`**: `Reactive (after startLockTask)` (default) or `Always Pinned (from launch)`.
   - **`Disable Pinning (startLockTask / stopLockTask)`** & **`Binder Stub$Proxy LockTask Interception`**.
   - **`Spoof ActivityManager Pin State`** & **`Hide Multi-Window & Picture-in-Picture`**.
   - **`Window Focus Spoofing (Safe)`**, **`WebView Visibility, JS & Pause Stealth`**, & **`Suppress onPause / onStop (Advanced)`**.
   - **`Simulate Pinned Window Insets`**, **`Strip FLAG_SECURE`**, **`Virtual Display & Screen Sharing Bypass`**, **`Unblock Clipboard Clear`**, **`Hide Accessibility & Overlay Checks`**, & **`Retain Audio Focus`**.
   - **`Cloak Packages & Play Store Installer`**, **`Sanitize Stack Traces`**, **`Spoof Motion Sensors (Stationary)`**, **`Static Package Signature Spoof`** + **`Original Certificate DER Hex`**, & **`Play Integrity / SafetyNet Soft-Fail`**.
   - **`Spoof Settings.System lock_to_app_enabled`**, **`Spoof DevicePolicyManager.isLockTaskPermitted`**, & **`Verbose Logcat Debug Logging`**.
4. Patch and install the modified APK.

## Option 2: LSPosed Setup

1. Install `PinSpoof-v1.3.1.apk` (from `PinSpoof-apks`).
2. Open **LSPosed Manager** -> **Modules** -> **PinSpoof**.
3. Enable the module and select **only the target apps** you want to affect (keep **System Framework (`android`) UNCHECKED**).
4. Open **PinSpoof**, tap **Select App Override** to expand inline per-app rules/presets (`Light` / `Balanced` / `Aggressive`), import/export JSON configs, or tap any **Live Hook Event Counter** tile to inspect triggered methods, then force-stop and relaunch your target app.

- **Package ID**: `us.redcatx.pinspoof`
- **Entry Class**: `us.redcatx.pinspoof.PinSpoofModule`

## Disclaimer & Support

This project was created with the assistance of Artificial Intelligence and is licensed under **GPL-3.0**. This software is provided **"as-is"**, without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and non-infringement.

**No user support is provided.** Do not expect assistance with troubleshooting, app compatibility, or custom configurations—fork the repository and implement your own changes if needed. Use responsibly and solely on devices and software where you are authorized to do so.
