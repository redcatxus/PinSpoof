package us.redcatx.pinspoof.patches

import app.morphe.patcher.Fingerprint
import app.morphe.patcher.extensions.InstructionExtensions.addInstructions
import app.morphe.patcher.extensions.InstructionExtensions.getInstruction
import app.morphe.patcher.extensions.InstructionExtensions.replaceInstruction
import app.morphe.patcher.methodCall
import app.morphe.patcher.patch.BytecodePatchContext
import app.morphe.patcher.patch.booleanOption
import app.morphe.patcher.patch.bytecodePatch
import app.morphe.patcher.patch.stringOption
import app.morphe.patcher.util.cloneParameters
import app.morphe.patcher.util.findFreeRegister
import app.morphe.patcher.util.matchAllMethodIndicesForEach
import app.morphe.patcher.util.numberOfParameterRegistersLogical
import app.morphe.patcher.util.p0Register
import app.morphe.patcher.util.proxy.mutableTypes.MutableMethod
import app.morphe.patcher.util.registersUsed
import app.morphe.patcher.util.returnEarly
import com.android.tools.smali.dexlib2.Opcode
import com.android.tools.smali.dexlib2.iface.ClassDef
import com.android.tools.smali.dexlib2.iface.instruction.ReferenceInstruction
import com.android.tools.smali.dexlib2.iface.reference.MethodReference

private const val EXTENSION_PREFIX = "Lus/redcatx/pinspoof/extension/"
private const val EXTENSION_CLASS = "Lus/redcatx/pinspoof/extension/PinSpoofHooks;"

private val ACTIVITY_BASE_TYPES = setOf(
    "Landroid/app/Activity;",
    "Landroidx/activity/ComponentActivity;",
    "Landroidx/fragment/app/FragmentActivity;",
    "Landroidx/appcompat/app/AppCompatActivity;",
)

private val FRAGMENT_BASE_TYPES = setOf(
    "Landroidx/fragment/app/Fragment;",
    "Landroid/app/Fragment;",
)

private val VIEW_BASE_TYPES = setOf(
    "Landroid/view/View;",
    "Landroid/view/ViewGroup;",
    "Landroid/widget/FrameLayout;",
    "Landroid/webkit/WebView;",
)

private val WEBVIEW_BASE_TYPES = setOf(
    "Landroid/webkit/WebView;",
)

private val WEBVIEW_CLIENT_BASE_TYPES = setOf(
    "Landroid/webkit/WebViewClient;",
)

private val WINDOW_BASE_TYPES = setOf(
    "Landroid/view/Window;",
)

private val SURFACE_VIEW_BASE_TYPES = setOf(
    "Landroid/view/SurfaceView;",
)

@Suppress("unused")
val pinSpoofPatch = bytecodePatch(
    name = "PinSpoof",
    description = "Disables app pinning (LockTask), spoofs pinned state, and applies focus, WebView, display, clipboard, sensor, and anti-detection patches directly in APKs without root or Xposed.",
    default = false,
) {
    val spoofTiming by stringOption(
        key = "spoofTiming",
        default = "reactive",
        values = mapOf(
            "Reactive (after startLockTask)" to "reactive",
            "Always Pinned (from launch)" to "always",
        ),
        title = "Spoof Timing Mode",
        description = "Reactive (recommended) spoofs pinned state only after startLockTask(); Always Pinned forces pinned from launch.",
    )

    val hookActivityLockTask by booleanOption(
        key = "hookActivityLockTask",
        default = true,
        title = "Disable Pinning (startLockTask / stopLockTask)",
        description = "Swallow Activity.startLockTask() and stopLockTask() calls so Android never enters Screen Pinning.",
    )

    val hookActivityManagerState by booleanOption(
        key = "hookActivityManagerState",
        default = true,
        title = "Spoof ActivityManager Pin State",
        description = "Return LOCK_TASK_MODE_PINNED (2) for getLockTaskModeState() and true for isInLockTaskMode().",
    )

    val hookBinderProxies by booleanOption(
        key = "hookBinderProxies",
        default = false,
        title = "Binder Stub\$Proxy LockTask Interception (Advanced)",
        description = "OFF by default: rewrite internal IActivityTaskManager/IActivityManager LockTask IPC calls directly.",
    )

    val hideFocusLoss by booleanOption(
        key = "hideFocusLoss",
        default = true,
        title = "Window Focus Spoofing (Safe)",
        description = "Drop onWindowFocusChanged(false), onTopResumedActivityChanged(false), onUserLeaveHint(), and spoof hasWindowFocus() & IMPORTANCE_FOREGROUND.",
    )

    val hideWebViewVisibility by booleanOption(
        key = "hideWebViewVisibility",
        default = true,
        title = "WebView Visibility, JS & Pause Stealth",
        description = "Force WebView visibility VISIBLE, block WebView.onPause()/pauseTimers()/onVisibilityAggregated(false), and inject DOM visibility/blur stealth JS.",
    )

    val hideLifecycleLoss by booleanOption(
        key = "hideLifecycleLoss",
        default = true,
        title = "Suppress onPause / onStop",
        description = "Block Activity/Fragment onPause(), onStop(), ActivityLifecycleCallbacks, and LifecycleRegistry transitions (disable if a SurfaceView/game stalls on resume).",
    )

    val hideMultiWindowAndPip by booleanOption(
        key = "hideMultiWindowAndPip",
        default = true,
        title = "Hide Multi-Window & Picture-in-Picture",
        description = "Return false for Activity.isInMultiWindowMode() and isInPictureInPictureMode().",
    )

    val spoofPinnedInsets by booleanOption(
        key = "spoofPinnedInsets",
        default = false,
        title = "Simulate Pinned Window Insets",
        description = "Report zeroed system bar WindowInsets while keeping your actual navigation bar and gestures usable.",
    )

    val stripFlagSecure by booleanOption(
        key = "stripFlagSecure",
        default = false,
        title = "Strip FLAG_SECURE",
        description = "Clear FLAG_SECURE on Windows and SurfaceViews so screenshots and recordings remain available.",
    )

    val bypassVirtualDisplays by booleanOption(
        key = "bypassVirtualDisplays",
        default = false,
        title = "Virtual Display & Screen Sharing Bypass",
        description = "Expose only Display.DEFAULT_DISPLAY in DisplayManager and filter secondary display listener callbacks.",
    )

    val unblockClipboard by booleanOption(
        key = "unblockClipboard",
        default = false,
        title = "Unblock Clipboard Clear",
        description = "Prevent ClipboardManager.clearPrimaryClip() and empty clip wipes during copy/paste.",
    )

    val hideAccessibilityAndOverlays by booleanOption(
        key = "hideAccessibilityAndOverlays",
        default = false,
        title = "Hide Accessibility & Overlay Checks",
        description = "Return empty AccessibilityManager service list and false for Settings.canDrawOverlays().",
    )

    val retainAudioFocus by booleanOption(
        key = "retainAudioFocus",
        default = false,
        title = "Retain Audio Focus",
        description = "Suppress negative AudioManager.OnAudioFocusChangeListener notifications when interruptions occur.",
    )

    val cloakPackagesAndInstaller by booleanOption(
        key = "cloakPackagesAndInstaller",
        default = false,
        title = "Cloak Packages & Play Store Installer",
        description = "Report com.android.vending as installer and hide Xposed/LSPosed/Morphe packages from PackageManager.",
    )

    val sanitizeStackTraces by booleanOption(
        key = "sanitizeStackTraces",
        default = false,
        title = "Sanitize Stack Traces",
        description = "Filter Xposed, LSPHooker, EdHooker, and PinSpoof frames from Thread/Throwable.getStackTrace().",
    )

    val spoofMotionSensors by booleanOption(
        key = "spoofMotionSensors",
        default = false,
        title = "Spoof Motion Sensors (Stationary)",
        description = "Clamp accelerometer, gyroscope, and significant-motion sensors to resting desk values.",
    )

    val spoofPackageSignature by booleanOption(
        key = "spoofPackageSignature",
        default = false,
        title = "Static Package Signature Spoof",
        description = "Replace PackageInfo.signatures returned by PackageManager.getPackageInfo() with Original Certificate DER Hex.",
    )

    val originalSignatureHex by stringOption(
        key = "originalSignatureHex",
        default = "",
        title = "Original Certificate DER Hex",
        description = "Optional hex-encoded X.509 DER certificate used when Static Package Signature Spoof is enabled.",
    )

    val softFailIntegrityChecks by booleanOption(
        key = "softFailIntegrityChecks",
        default = false,
        title = "Play Integrity / SafetyNet Soft-Fail",
        description = "Clear local Integrity / SafetyNet / attestation exceptions on Task.getException() checks.",
    )

    val hookSettingsLockToApp by booleanOption(
        key = "hookSettingsLockToApp",
        default = false,
        title = "Spoof Settings.System lock_to_app_enabled",
        description = "Return 1 when the target app queries Settings.System lock_to_app_enabled.",
    )

    val hookDevicePolicyPermitted by booleanOption(
        key = "hookDevicePolicyPermitted",
        default = false,
        title = "Spoof DevicePolicyManager.isLockTaskPermitted",
        description = "Return true when the target app checks DevicePolicyManager.isLockTaskPermitted().",
    )

    val debugLogging by booleanOption(
        key = "debugLogging",
        default = false,
        title = "Verbose Logcat Debug Logging",
        description = "Emit Log.d(\"PinSpoof\", ...) traces when patched hooks intercept pinning or focus events.",
    )

    extendWith("extensions/extension.mpe")

    execute {
        val alwaysPinned = spoofTiming == "always"
        Fingerprint(definingClass = EXTENSION_CLASS, name = "alwaysSpoofPinned")
            .method
            .returnEarly(alwaysPinned)
        Fingerprint(definingClass = EXTENSION_CLASS, name = "debugLogging")
            .method
            .returnEarly(debugLogging == true)
        Fingerprint(definingClass = EXTENSION_CLASS, name = "cloakPackagesEnabled")
            .method
            .returnEarly(cloakPackagesAndInstaller == true)
        Fingerprint(definingClass = EXTENSION_CLASS, name = "spoofSignatureEnabled")
            .method
            .returnEarly(spoofPackageSignature == true)

        val escapedSigHex = (originalSignatureHex ?: "")
            .replace("\\", "")
            .replace("\"", "")
            .replace(":", "")
            .replace(" ", "")
            .trim()
        if (escapedSigHex.isNotEmpty()) {
            Fingerprint(definingClass = EXTENSION_CLASS, name = "originalSignatureHex")
                .method
                .addInstructions(
                    0,
                    """
                        const-string v0, "$escapedSigHex"
                        return-object v0
                    """.trimIndent(),
                )
        }

        if (hookActivityLockTask == true) {
            rewriteInstanceCalls(
                methodName = "startLockTask",
                parameters = emptyList(),
                returnType = "V",
                matchesReceiver = { isActivityType(it) },
                targetMethod = "$EXTENSION_CLASS->startLockTask(Landroid/app/Activity;)V",
            )
            rewriteInstanceCalls(
                methodName = "stopLockTask",
                parameters = emptyList(),
                returnType = "V",
                matchesReceiver = { isActivityType(it) },
                targetMethod = "$EXTENSION_CLASS->stopLockTask(Landroid/app/Activity;)V",
            )
            swallowLockTaskTokenCalls(includeBinderProxies = hookBinderProxies == true)
        }

        if (hookActivityManagerState == true) {
            rewriteInstanceCalls(
                methodName = "getLockTaskModeState",
                parameters = emptyList(),
                returnType = "I",
                matchesReceiver = { it == "Landroid/app/ActivityManager;" },
                targetMethod = "$EXTENSION_CLASS->getLockTaskModeState(Landroid/app/ActivityManager;)I",
            )
            rewriteInstanceCalls(
                methodName = "isInLockTaskMode",
                parameters = emptyList(),
                returnType = "Z",
                matchesReceiver = { it == "Landroid/app/ActivityManager;" },
                targetMethod = "$EXTENSION_CLASS->isInLockTaskMode(Landroid/app/ActivityManager;)Z",
            )
        }

        if (hideFocusLoss == true) {
            rewriteInstanceCalls(
                methodName = "hasWindowFocus",
                parameters = emptyList(),
                returnType = "Z",
                matchesReceiver = { isActivityType(it) },
                targetMethod = "$EXTENSION_CLASS->hasWindowFocus(Landroid/app/Activity;)Z",
            )
            rewriteInstanceCalls(
                methodName = "hasWindowFocus",
                parameters = emptyList(),
                returnType = "Z",
                matchesReceiver = { isViewType(it) },
                targetMethod = "$EXTENSION_CLASS->hasWindowFocus(Landroid/view/View;)Z",
            )
            rewriteInstanceCalls(
                methodName = "getRunningAppProcesses",
                parameters = emptyList(),
                returnType = "Ljava/util/List;",
                matchesReceiver = { it == "Landroid/app/ActivityManager;" },
                targetMethod = "$EXTENSION_CLASS->getRunningAppProcesses(Landroid/app/ActivityManager;)Ljava/util/List;",
            )
            methodCall(
                smali = "Landroid/app/ActivityManager;->getMyMemoryState(Landroid/app/ActivityManager\$RunningAppProcessInfo;)V"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "$EXTENSION_CLASS->getMyMemoryState(Landroid/app/ActivityManager\$RunningAppProcessInfo;)V",
                    )
                }
            }
        }

        if (hideWebViewVisibility == true) {
            rewriteInstanceCalls(
                methodName = "onPause",
                parameters = emptyList(),
                returnType = "V",
                matchesReceiver = { isWebViewType(it) },
                targetMethod = "$EXTENSION_CLASS->onWebViewPause(Landroid/webkit/WebView;)V",
            )
            rewriteInstanceCalls(
                methodName = "pauseTimers",
                parameters = emptyList(),
                returnType = "V",
                matchesReceiver = { isWebViewType(it) },
                targetMethod = "$EXTENSION_CLASS->onWebViewPauseTimers(Landroid/webkit/WebView;)V",
            )
            rewriteInstanceCalls(
                methodName = "getWindowVisibility",
                parameters = emptyList(),
                returnType = "I",
                matchesReceiver = { isWebViewType(it) },
                targetMethod = "$EXTENSION_CLASS->getWebViewWindowVisibility(Landroid/webkit/WebView;)I",
            )
            rewriteInstanceCalls(
                methodName = "setWebViewClient",
                parameters = listOf("Landroid/webkit/WebViewClient;"),
                returnType = "V",
                matchesReceiver = { isWebViewType(it) },
                targetMethod = "$EXTENSION_CLASS->onWebViewSetClient(Landroid/webkit/WebView;Landroid/webkit/WebViewClient;)V",
            )
            rewriteInstanceCalls(
                methodName = "loadUrl",
                parameters = listOf("Ljava/lang/String;"),
                returnType = "V",
                matchesReceiver = { isWebViewType(it) },
                targetMethod = "$EXTENSION_CLASS->onWebViewLoadUrl(Landroid/webkit/WebView;Ljava/lang/String;)V",
            )
            rewriteInstanceCalls(
                methodName = "loadUrl",
                parameters = listOf("Ljava/lang/String;", "Ljava/util/Map;"),
                returnType = "V",
                matchesReceiver = { isWebViewType(it) },
                targetMethod = "$EXTENSION_CLASS->onWebViewLoadUrl(Landroid/webkit/WebView;Ljava/lang/String;Ljava/util/Map;)V",
            )
        }

        if (hideMultiWindowAndPip == true) {
            rewriteInstanceCalls(
                methodName = "isInMultiWindowMode",
                parameters = emptyList(),
                returnType = "Z",
                matchesReceiver = { isActivityType(it) },
                targetMethod = "$EXTENSION_CLASS->isInMultiWindowMode(Landroid/app/Activity;)Z",
            )
            rewriteInstanceCalls(
                methodName = "isInPictureInPictureMode",
                parameters = emptyList(),
                returnType = "Z",
                matchesReceiver = { isActivityType(it) },
                targetMethod = "$EXTENSION_CLASS->isInPictureInPictureMode(Landroid/app/Activity;)Z",
            )
        }

        if (spoofPinnedInsets == true) {
            rewriteInstanceCalls(
                methodName = "getInsets",
                parameters = listOf("I"),
                returnType = "Landroid/graphics/Insets;",
                matchesReceiver = { it == "Landroid/view/WindowInsets;" },
                targetMethod = "$EXTENSION_CLASS->getWindowInsets(Landroid/view/WindowInsets;I)Landroid/graphics/Insets;",
            )
            rewriteInstanceCalls(
                methodName = "isVisible",
                parameters = listOf("I"),
                returnType = "Z",
                matchesReceiver = { it == "Landroid/view/WindowInsets;" },
                targetMethod = "$EXTENSION_CLASS->isWindowInsetsVisible(Landroid/view/WindowInsets;I)Z",
            )
            listOf(
                "getSystemWindowInsetTop",
                "getSystemWindowInsetBottom",
                "getSystemWindowInsetLeft",
                "getSystemWindowInsetRight",
            ).forEach { insetMethod ->
                rewriteInstanceCalls(
                    methodName = insetMethod,
                    parameters = emptyList(),
                    returnType = "I",
                    matchesReceiver = { it == "Landroid/view/WindowInsets;" },
                    targetMethod = "$EXTENSION_CLASS->getZeroSystemInset(Landroid/view/WindowInsets;)I",
                )
            }
        }

        if (stripFlagSecure == true) {
            rewriteInstanceCalls(
                methodName = "setFlags",
                parameters = listOf("I", "I"),
                returnType = "V",
                matchesReceiver = { isWindowType(it) },
                targetMethod = "$EXTENSION_CLASS->windowSetFlags(Landroid/view/Window;II)V",
            )
            rewriteInstanceCalls(
                methodName = "addFlags",
                parameters = listOf("I"),
                returnType = "V",
                matchesReceiver = { isWindowType(it) },
                targetMethod = "$EXTENSION_CLASS->windowAddFlags(Landroid/view/Window;I)V",
            )
            rewriteInstanceCalls(
                methodName = "setSecure",
                parameters = listOf("Z"),
                returnType = "V",
                matchesReceiver = { isSurfaceViewType(it) },
                targetMethod = "$EXTENSION_CLASS->surfaceViewSetSecure(Landroid/view/SurfaceView;Z)V",
            )
        }

        if (bypassVirtualDisplays == true) {
            rewriteInstanceCalls(
                methodName = "getDisplays",
                parameters = emptyList(),
                returnType = "[Landroid/view/Display;",
                matchesReceiver = { it == "Landroid/hardware/display/DisplayManager;" },
                targetMethod = "$EXTENSION_CLASS->getDisplays(Landroid/hardware/display/DisplayManager;)[Landroid/view/Display;",
            )
            rewriteInstanceCalls(
                methodName = "getDisplays",
                parameters = listOf("Ljava/lang/String;"),
                returnType = "[Landroid/view/Display;",
                matchesReceiver = { it == "Landroid/hardware/display/DisplayManager;" },
                targetMethod = "$EXTENSION_CLASS->getDisplays(Landroid/hardware/display/DisplayManager;Ljava/lang/String;)[Landroid/view/Display;",
            )
            rewriteInstanceCalls(
                methodName = "getDisplay",
                parameters = listOf("I"),
                returnType = "Landroid/view/Display;",
                matchesReceiver = { it == "Landroid/hardware/display/DisplayManager;" },
                targetMethod = "$EXTENSION_CLASS->getDisplay(Landroid/hardware/display/DisplayManager;I)Landroid/view/Display;",
            )
        }

        if (unblockClipboard == true) {
            rewriteInstanceCalls(
                methodName = "clearPrimaryClip",
                parameters = emptyList(),
                returnType = "V",
                matchesReceiver = { it == "Landroid/content/ClipboardManager;" },
                targetMethod = "$EXTENSION_CLASS->onClipboardClear(Landroid/content/ClipboardManager;)V",
            )
            rewriteInstanceCalls(
                methodName = "setPrimaryClip",
                parameters = listOf("Landroid/content/ClipData;"),
                returnType = "V",
                matchesReceiver = { it == "Landroid/content/ClipboardManager;" },
                targetMethod = "$EXTENSION_CLASS->onClipboardSetPrimaryClip(Landroid/content/ClipboardManager;Landroid/content/ClipData;)V",
            )
        }

        if (hideAccessibilityAndOverlays == true) {
            methodCall(
                smali = "Landroid/view/accessibility/AccessibilityManager;->getEnabledAccessibilityServiceList(I)Ljava/util/List;"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "$EXTENSION_CLASS->getEnabledAccessibilityServiceList(Landroid/view/accessibility/AccessibilityManager;I)Ljava/util/List;",
                    )
                }
            }
            methodCall(
                smali = "Landroid/provider/Settings;->canDrawOverlays(Landroid/content/Context;)Z"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "$EXTENSION_CLASS->canDrawOverlays(Landroid/content/Context;)Z",
                    )
                }
            }
        }

        if (cloakPackagesAndInstaller == true) {
            rewriteInstanceCalls(
                methodName = "getInstallerPackageName",
                parameters = listOf("Ljava/lang/String;"),
                returnType = "Ljava/lang/String;",
                matchesReceiver = { it == "Landroid/content/pm/PackageManager;" },
                targetMethod = "$EXTENSION_CLASS->getInstallerPackageName(Landroid/content/pm/PackageManager;Ljava/lang/String;)Ljava/lang/String;",
            )
            rewriteInstanceCalls(
                methodName = "getInstalledPackages",
                parameters = listOf("I"),
                returnType = "Ljava/util/List;",
                matchesReceiver = { it == "Landroid/content/pm/PackageManager;" },
                targetMethod = "$EXTENSION_CLASS->getInstalledPackages(Landroid/content/pm/PackageManager;I)Ljava/util/List;",
            )
            rewriteInstanceCalls(
                methodName = "getInstalledApplications",
                parameters = listOf("I"),
                returnType = "Ljava/util/List;",
                matchesReceiver = { it == "Landroid/content/pm/PackageManager;" },
                targetMethod = "$EXTENSION_CLASS->getInstalledApplications(Landroid/content/pm/PackageManager;I)Ljava/util/List;",
            )
            rewriteInstanceCalls(
                methodName = "queryIntentActivities",
                parameters = listOf("Landroid/content/Intent;", "I"),
                returnType = "Ljava/util/List;",
                matchesReceiver = { it == "Landroid/content/pm/PackageManager;" },
                targetMethod = "$EXTENSION_CLASS->queryIntentActivities(Landroid/content/pm/PackageManager;Landroid/content/Intent;I)Ljava/util/List;",
            )
        }

        if (cloakPackagesAndInstaller == true || spoofPackageSignature == true) {
            rewriteInstanceCalls(
                methodName = "getPackageInfo",
                parameters = listOf("Ljava/lang/String;", "I"),
                returnType = "Landroid/content/pm/PackageInfo;",
                matchesReceiver = { it == "Landroid/content/pm/PackageManager;" },
                targetMethod = "$EXTENSION_CLASS->getPackageInfo(Landroid/content/pm/PackageManager;Ljava/lang/String;I)Landroid/content/pm/PackageInfo;",
            )
        }

        if (sanitizeStackTraces == true) {
            methodCall(
                smali = "Ljava/lang/Thread;->getStackTrace()[Ljava/lang/StackTraceElement;"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "$EXTENSION_CLASS->getThreadStackTrace(Ljava/lang/Thread;)[Ljava/lang/StackTraceElement;",
                    )
                }
            }
            methodCall(
                smali = "Ljava/lang/Throwable;->getStackTrace()[Ljava/lang/StackTraceElement;"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "$EXTENSION_CLASS->getThrowableStackTrace(Ljava/lang/Throwable;)[Ljava/lang/StackTraceElement;",
                    )
                }
            }
        }

        if (spoofMotionSensors == true) {
            methodCall(
                smali = "Landroid/hardware/SensorManager;->requestTriggerSensor(Landroid/hardware/TriggerEventListener;Landroid/hardware/Sensor;)Z"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "$EXTENSION_CLASS->requestTriggerSensor(Landroid/hardware/SensorManager;Landroid/hardware/TriggerEventListener;Landroid/hardware/Sensor;)Z",
                    )
                }
            }
        }

        if (softFailIntegrityChecks == true) {
            listOf(
                "Lcom/google/android/gms/tasks/Task;->getException()Ljava/lang/Exception;",
                "Lcom/google/android/play/core/tasks/Task;->getException()Ljava/lang/Exception;",
            ).forEach { sig ->
                methodCall(smali = sig).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                    if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                        replaceCallAt(
                            index,
                            "$EXTENSION_CLASS->softFailTaskException(Ljava/lang/Object;)Ljava/lang/Exception;",
                        )
                    }
                }
            }
        }

        if (hookSettingsLockToApp == true) {
            methodCall(
                smali = "Landroid/provider/Settings\$System;->getInt(Landroid/content/ContentResolver;Ljava/lang/String;I)I"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "$EXTENSION_CLASS->getSettingsSystemInt(Landroid/content/ContentResolver;Ljava/lang/String;I)I",
                    )
                }
            }
            methodCall(
                smali = "Landroid/provider/Settings\$System;->getInt(Landroid/content/ContentResolver;Ljava/lang/String;)I"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "$EXTENSION_CLASS->getSettingsSystemInt(Landroid/content/ContentResolver;Ljava/lang/String;)I",
                    )
                }
            }
        }

        if (hookDevicePolicyPermitted == true) {
            methodCall(
                smali = "Landroid/app/admin/DevicePolicyManager;->isLockTaskPermitted(Ljava/lang/String;)Z"
            ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
                if (!definingClass.startsWith(EXTENSION_PREFIX)) {
                    replaceCallAt(
                        index,
                        "$EXTENSION_CLASS->isLockTaskPermitted(Landroid/app/admin/DevicePolicyManager;Ljava/lang/String;)Z",
                    )
                }
            }
        }

        if (hideFocusLoss == true ||
            hideWebViewVisibility == true ||
            hideLifecycleLoss == true ||
            retainAudioFocus == true ||
            spoofMotionSensors == true ||
            bypassVirtualDisplays == true
        ) {
            patchAppSubclassOverrides(
                hideFocus = hideFocusLoss == true,
                hideWebView = hideWebViewVisibility == true,
                hideLifecycle = hideLifecycleLoss == true,
                retainAudio = retainAudioFocus == true,
                spoofSensors = spoofMotionSensors == true,
                bypassDisplays = bypassVirtualDisplays == true,
            )
        }
    }
}

private fun BytecodePatchContext.isFrameworkType(type: String): Boolean =
    type.startsWith("Landroid/") ||
        type.startsWith("Landroidx/") ||
        type.startsWith("Lcom/android/") ||
        type.startsWith("Ljava/") ||
        type.startsWith("Lkotlin/") ||
        type.startsWith("Lkotlinx/") ||
        type.startsWith(EXTENSION_PREFIX)

private fun BytecodePatchContext.hasAncestorIn(classType: String, targets: Set<String>): Boolean {
    var current: String? = classType
    var depth = 0
    while (current != null && depth < 32) {
        if (current in targets) return true
        val def = classDefByOrNull(current) ?: break
        current = def.superclass
        depth++
    }
    return false
}

private fun BytecodePatchContext.isActivityType(classType: String): Boolean =
    hasAncestorIn(classType, ACTIVITY_BASE_TYPES)

private fun BytecodePatchContext.isFragmentType(classType: String): Boolean =
    hasAncestorIn(classType, FRAGMENT_BASE_TYPES)

private fun BytecodePatchContext.isViewType(classType: String): Boolean =
    hasAncestorIn(classType, VIEW_BASE_TYPES)

private fun BytecodePatchContext.isWebViewType(classType: String): Boolean =
    hasAncestorIn(classType, WEBVIEW_BASE_TYPES)

private fun BytecodePatchContext.isWebViewClientType(classType: String): Boolean =
    hasAncestorIn(classType, WEBVIEW_CLIENT_BASE_TYPES)

private fun BytecodePatchContext.isWindowType(classType: String): Boolean =
    hasAncestorIn(classType, WINDOW_BASE_TYPES)

private fun BytecodePatchContext.isSurfaceViewType(classType: String): Boolean =
    hasAncestorIn(classType, SURFACE_VIEW_BASE_TYPES)

private fun BytecodePatchContext.rewriteInstanceCalls(
    methodName: String,
    parameters: List<String>,
    returnType: String,
    matchesReceiver: BytecodePatchContext.(String) -> Boolean,
    targetMethod: String,
) {
    methodCall(
        name = methodName,
        parameters = parameters,
        returnType = returnType,
    ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
        if (definingClass.startsWith(EXTENSION_PREFIX)) return@matchAllMethodIndicesForEach
        val insn = getInstruction(index)
        if (insn.opcode == Opcode.INVOKE_SUPER || insn.opcode == Opcode.INVOKE_SUPER_RANGE) {
            return@matchAllMethodIndicesForEach
        }
        val ref = (insn as? ReferenceInstruction)?.reference as? MethodReference ?: return@matchAllMethodIndicesForEach
        if (!matchesReceiver(ref.definingClass)) return@matchAllMethodIndicesForEach
        replaceCallAt(index, targetMethod)
    }
}

private fun BytecodePatchContext.swallowLockTaskTokenCalls(includeBinderProxies: Boolean) {
    listOf("startLockTaskModeByToken", "startLockTaskMode").forEach { name ->
        methodCall(
            name = name,
            returnType = "V",
        ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
            if (definingClass.startsWith(EXTENSION_PREFIX)) return@matchAllMethodIndicesForEach
            val ref = (getInstruction(index) as? ReferenceInstruction)?.reference as? MethodReference
                ?: return@matchAllMethodIndicesForEach
            val isClient = ref.definingClass == "Landroid/app/ActivityClient;"
            val isBinder = includeBinderProxies && ref.definingClass.startsWith("Landroid/app/IActivity")
            if (isClient || isBinder) {
                replaceInstruction(index, "invoke-static {}, $EXTENSION_CLASS->onLockTaskTokenCall()V")
            }
        }
    }
}

private fun MutableMethod.replaceCallAt(index: Int, targetMethod: String) {
    val insn = getInstruction(index)
    val regs = insn.registersUsed
    val useRange = insn.opcode.name.endsWith("_RANGE") || regs.any { it > 15 }
    val invokeSmali = when {
        regs.isEmpty() -> "invoke-static {}, $targetMethod"
        useRange -> "invoke-static/range { v${regs.first()} .. v${regs.last()} }, $targetMethod"
        else -> "invoke-static { ${regs.joinToString(", ") { "v$it" }} }, $targetMethod"
    }
    replaceInstruction(index, invokeSmali)
}

private fun BytecodePatchContext.patchAppSubclassOverrides(
    hideFocus: Boolean,
    hideWebView: Boolean,
    hideLifecycle: Boolean,
    retainAudio: Boolean,
    spoofSensors: Boolean,
    bypassDisplays: Boolean,
) {
    val activityTargets = mutableListOf<ClassDef>()
    val fragmentTargets = mutableListOf<ClassDef>()
    val viewTargets = mutableListOf<ClassDef>()
    val webViewClientTargets = mutableListOf<ClassDef>()
    val lifecycleCallbackTargets = mutableListOf<ClassDef>()
    val focusListenerTargets = mutableListOf<ClassDef>()
    val windowFocusHolderTargets = mutableListOf<ClassDef>()
    val broadcastReceiverTargets = mutableListOf<ClassDef>()
    val audioListenerTargets = mutableListOf<ClassDef>()
    val sensorListenerTargets = mutableListOf<ClassDef>()
    val displayListenerTargets = mutableListOf<ClassDef>()

    classDefForEach { classDef ->
        val type = classDef.type
        if (isFrameworkType(type)) return@classDefForEach

        if ((hideFocus || hideLifecycle) && isActivityType(type)) {
            val hasActivityHook = classDef.methods.any { m ->
                m.implementation != null && (
                    (hideFocus && ((m.name == "onWindowFocusChanged" && m.parameterTypes == listOf("Z") && m.returnType == "V") ||
                        (m.name == "onTopResumedActivityChanged" && m.parameterTypes == listOf("Z") && m.returnType == "V") ||
                        (m.name == "onUserLeaveHint" && m.parameterTypes.isEmpty() && m.returnType == "V"))) ||
                        (hideLifecycle && ((m.name == "onUserLeaveHint" && m.parameterTypes.isEmpty() && m.returnType == "V") ||
                            (m.name == "onPause" && m.parameterTypes.isEmpty() && m.returnType == "V") ||
                            (m.name == "onStop" && m.parameterTypes.isEmpty() && m.returnType == "V") ||
                            (m.name == "onTopResumedActivityChanged" && m.parameterTypes == listOf("Z") && m.returnType == "V")))
                    )
            }
            if (hasActivityHook) activityTargets += classDef
        }

        if (hideLifecycle && isFragmentType(type)) {
            val hasFragHook = classDef.methods.any { m ->
                m.implementation != null &&
                    (m.name == "onPause" || m.name == "onStop") &&
                    m.parameterTypes.isEmpty() &&
                    m.returnType == "V"
            }
            if (hasFragHook) fragmentTargets += classDef
        }

        if ((hideFocus || hideWebView) && isViewType(type)) {
            val hasViewHook = classDef.methods.any { m ->
                m.implementation != null && (
                    (hideFocus && m.name == "onWindowFocusChanged" && m.parameterTypes == listOf("Z") && m.returnType == "V") ||
                        (hideWebView && ((m.name == "onWindowVisibilityChanged" && m.parameterTypes == listOf("I") && m.returnType == "V") ||
                            (m.name == "onVisibilityAggregated" && m.parameterTypes == listOf("Z") && m.returnType == "V")))
                    )
            }
            if (hasViewHook) viewTargets += classDef
        }

        if (hideWebView && isWebViewClientType(type)) {
            val hasWebCb = classDef.methods.any { m ->
                m.implementation != null && (
                    (m.name == "onPageFinished" &&
                        m.parameterTypes == listOf("Landroid/webkit/WebView;", "Ljava/lang/String;") &&
                        m.returnType == "V") ||
                        (m.name == "onPageStarted" &&
                            m.parameterTypes == listOf("Landroid/webkit/WebView;", "Ljava/lang/String;", "Landroid/graphics/Bitmap;") &&
                            m.returnType == "V")
                    )
            }
            if (hasWebCb) webViewClientTargets += classDef
        }

        if (hideLifecycle && "Landroid/app/Application\$ActivityLifecycleCallbacks;" in classDef.interfaces) {
            val hasCb = classDef.methods.any { m ->
                m.implementation != null &&
                    (m.name == "onActivityPaused" || m.name == "onActivityStopped") &&
                    m.parameterTypes == listOf("Landroid/app/Activity;") &&
                    m.returnType == "V"
            }
            if (hasCb) lifecycleCallbackTargets += classDef
        }

        if (hideFocus && "Landroid/view/ViewTreeObserver\$OnWindowFocusChangeListener;" in classDef.interfaces) {
            val hasListener = classDef.methods.any { m ->
                m.implementation != null &&
                    m.name == "onWindowFocusChanged" &&
                    m.parameterTypes == listOf("Z") &&
                    m.returnType == "V"
            }
            if (hasListener) focusListenerTargets += classDef
        }

        if (hideFocus && !isActivityType(type) && !isViewType(type) &&
            (hasAncestorIn(type, setOf("Landroid/app/Dialog;")) || "Landroid/view/Window\$Callback;" in classDef.interfaces)
        ) {
            val hasFocusCb = classDef.methods.any { m ->
                m.implementation != null &&
                    m.name == "onWindowFocusChanged" &&
                    m.parameterTypes == listOf("Z") &&
                    m.returnType == "V"
            }
            if (hasFocusCb) windowFocusHolderTargets += classDef
        }

        if (hideFocus && hasAncestorIn(type, setOf("Landroid/content/BroadcastReceiver;"))) {
            val hasOnReceive = classDef.methods.any { m ->
                m.implementation != null &&
                    m.name == "onReceive" &&
                    m.parameterTypes == listOf("Landroid/content/Context;", "Landroid/content/Intent;") &&
                    m.returnType == "V"
            }
            if (hasOnReceive) broadcastReceiverTargets += classDef
        }

        if (retainAudio && "Landroid/media/AudioManager\$OnAudioFocusChangeListener;" in classDef.interfaces) {
            val hasAudio = classDef.methods.any { m ->
                m.implementation != null &&
                    m.name == "onAudioFocusChange" &&
                    m.parameterTypes == listOf("I") &&
                    m.returnType == "V"
            }
            if (hasAudio) audioListenerTargets += classDef
        }

        if (spoofSensors && "Landroid/hardware/SensorEventListener;" in classDef.interfaces) {
            val hasSensor = classDef.methods.any { m ->
                m.implementation != null &&
                    m.name == "onSensorChanged" &&
                    m.parameterTypes == listOf("Landroid/hardware/SensorEvent;") &&
                    m.returnType == "V"
            }
            if (hasSensor) sensorListenerTargets += classDef
        }

        if (bypassDisplays && "Landroid/hardware/display/DisplayManager\$DisplayListener;" in classDef.interfaces) {
            val hasDisplayCb = classDef.methods.any { m ->
                m.implementation != null &&
                    (m.name == "onDisplayAdded" || m.name == "onDisplayChanged") &&
                    m.parameterTypes == listOf("I") &&
                    m.returnType == "V"
            }
            if (hasDisplayCb) displayListenerTargets += classDef
        }
    }

    activityTargets.forEach { classDef ->
        val superType = classDef.superclass ?: "Landroid/app/Activity;"
        val mutable = mutableClassDefBy(classDef)
        for (method in mutable.methods.toList()) {
            if (method.implementation == null) continue
            when {
                hideFocus &&
                    method.name == "onWindowFocusChanged" &&
                    method.parameterTypes == listOf("Z") &&
                    method.returnType == "V" -> {
                    skipWhenBooleanParamFalse(method)
                }
                (hideFocus || hideLifecycle) &&
                    method.name == "onTopResumedActivityChanged" &&
                    method.parameterTypes == listOf("Z") &&
                    method.returnType == "V" -> {
                    skipWhenBooleanParamFalse(method)
                }
                (hideFocus || hideLifecycle) &&
                    method.name == "onUserLeaveHint" &&
                    method.parameterTypes.isEmpty() &&
                    method.returnType == "V" -> {
                    bypassActivityLifecycleMethod(method, superType, "onUserLeaveHint", callSuper = false)
                }
                hideLifecycle &&
                    method.name == "onPause" &&
                    method.parameterTypes.isEmpty() &&
                    method.returnType == "V" -> {
                    bypassActivityLifecycleMethod(method, superType, "onPause", callSuper = true)
                }
                hideLifecycle &&
                    method.name == "onStop" &&
                    method.parameterTypes.isEmpty() &&
                    method.returnType == "V" -> {
                    bypassActivityLifecycleMethod(method, superType, "onStop", callSuper = true)
                }
            }
        }
    }

    fragmentTargets.forEach { classDef ->
        val superType = classDef.superclass ?: "Landroidx/fragment/app/Fragment;"
        val mutable = mutableClassDefBy(classDef)
        for (method in mutable.methods.toList()) {
            if (method.implementation == null) continue
            if ((method.name == "onPause" || method.name == "onStop") &&
                method.parameterTypes.isEmpty() &&
                method.returnType == "V"
            ) {
                bypassFragmentLifecycleMethod(method, superType, method.name)
            }
        }
    }

    viewTargets.forEach { classDef ->
        val mutable = mutableClassDefBy(classDef)
        for (method in mutable.methods.toList()) {
            if (method.implementation == null) continue
            if (hideFocus &&
                method.name == "onWindowFocusChanged" &&
                method.parameterTypes == listOf("Z") &&
                method.returnType == "V"
            ) {
                skipWhenBooleanParamFalse(method)
            } else if (hideWebView &&
                method.name == "onWindowVisibilityChanged" &&
                method.parameterTypes == listOf("I") &&
                method.returnType == "V"
            ) {
                forceWindowVisibilityVisible(method)
            } else if (hideWebView &&
                method.name == "onVisibilityAggregated" &&
                method.parameterTypes == listOf("Z") &&
                method.returnType == "V"
            ) {
                forceVisibilityAggregatedTrue(method)
            }
        }
    }

    webViewClientTargets.forEach { classDef ->
        val mutable = mutableClassDefBy(classDef)
        for (method in mutable.methods.toList()) {
            if (method.implementation == null) continue
            if ((method.name == "onPageFinished" &&
                    method.parameterTypes == listOf("Landroid/webkit/WebView;", "Ljava/lang/String;") &&
                    method.returnType == "V") ||
                (method.name == "onPageStarted" &&
                    method.parameterTypes == listOf("Landroid/webkit/WebView;", "Ljava/lang/String;", "Landroid/graphics/Bitmap;") &&
                    method.returnType == "V")
            ) {
                method.addInstructions(
                    0,
                    "invoke-static/range { p1 .. p1 }, $EXTENSION_CLASS->injectWebViewStealth(Landroid/webkit/WebView;)V",
                )
            }
        }
    }

    lifecycleCallbackTargets.forEach { classDef ->
        val mutable = mutableClassDefBy(classDef)
        for (method in mutable.methods.toList()) {
            if (method.implementation == null) continue
            if ((method.name == "onActivityPaused" || method.name == "onActivityStopped") &&
                method.parameterTypes == listOf("Landroid/app/Activity;") &&
                method.returnType == "V"
            ) {
                skipLifecycleCallbackIfNotFinishing(method)
            }
        }
    }

    focusListenerTargets.forEach { classDef ->
        val mutable = mutableClassDefBy(classDef)
        for (method in mutable.methods.toList()) {
            if (method.implementation == null) continue
            if (method.name == "onWindowFocusChanged" &&
                method.parameterTypes == listOf("Z") &&
                method.returnType == "V"
            ) {
                skipWhenBooleanParamFalse(method)
            }
        }
    }

    windowFocusHolderTargets.forEach { classDef ->
        val mutable = mutableClassDefBy(classDef)
        for (method in mutable.methods.toList()) {
            if (method.implementation == null) continue
            if (method.name == "onWindowFocusChanged" &&
                method.parameterTypes == listOf("Z") &&
                method.returnType == "V"
            ) {
                skipWhenBooleanParamFalse(method)
            }
        }
    }

    broadcastReceiverTargets.forEach { classDef ->
        val mutable = mutableClassDefBy(classDef)
        for (method in mutable.methods.toList()) {
            if (method.implementation == null) continue
            if (method.name == "onReceive" &&
                method.parameterTypes == listOf("Landroid/content/Context;", "Landroid/content/Intent;") &&
                method.returnType == "V"
            ) {
                suppressCloseSystemDialogsBroadcast(method)
            }
        }
    }

    audioListenerTargets.forEach { classDef ->
        val mutable = mutableClassDefBy(classDef)
        for (method in mutable.methods.toList()) {
            if (method.implementation == null) continue
            if (method.name == "onAudioFocusChange" &&
                method.parameterTypes == listOf("I") &&
                method.returnType == "V"
            ) {
                suppressAudioFocusLoss(method)
            }
        }
    }

    sensorListenerTargets.forEach { classDef ->
        val mutable = mutableClassDefBy(classDef)
        for (method in mutable.methods.toList()) {
            if (method.implementation == null) continue
            if (method.name == "onSensorChanged" &&
                method.parameterTypes == listOf("Landroid/hardware/SensorEvent;") &&
                method.returnType == "V"
            ) {
                method.addInstructions(
                    0,
                    "invoke-static/range { p1 .. p1 }, $EXTENSION_CLASS->sanitizeSensorEvent(Landroid/hardware/SensorEvent;)V",
                )
            }
        }
    }

    displayListenerTargets.forEach { classDef ->
        val mutable = mutableClassDefBy(classDef)
        for (method in mutable.methods.toList()) {
            if (method.implementation == null) continue
            if ((method.name == "onDisplayAdded" || method.name == "onDisplayChanged") &&
                method.parameterTypes == listOf("I") &&
                method.returnType == "V"
            ) {
                skipNonDefaultDisplayCallback(method)
            }
        }
    }

    if (hideLifecycle) {
        classDefByOrNull("Landroidx/lifecycle/LifecycleRegistry;")?.let { registryClass ->
            val mutable = mutableClassDefBy(registryClass)
            val handleMethod = mutable.methods.firstOrNull {
                it.implementation != null &&
                    it.name == "handleLifecycleEvent" &&
                    it.parameterTypes == listOf("Landroidx/lifecycle/Lifecycle\$Event;") &&
                    it.returnType == "V"
            }
            if (handleMethod != null) {
                prepareEntryScratch(handleMethod) { freeReg, _, p1Reg ->
                    """
                        invoke-static/range { $p1Reg .. $p1Reg }, $EXTENSION_CLASS->shouldSuppressLifecycleEvent(Ljava/lang/Object;)Z
                        move-result $freeReg
                        if-eqz $freeReg, :pinspoof_orig
                        return-void
                        :pinspoof_orig
                        nop
                    """.trimIndent()
                }
            }
        }
    }
}

private fun skipWhenBooleanParamFalse(method: MutableMethod) {
    method.addInstructions(
        0,
        """
            if-nez p1, :pinspoof_keep
            return-void
            :pinspoof_keep
            nop
        """.trimIndent(),
    )
}

private fun skipNonDefaultDisplayCallback(method: MutableMethod) {
    method.addInstructions(
        0,
        """
            if-eqz p1, :pinspoof_default
            return-void
            :pinspoof_default
            nop
        """.trimIndent(),
    )
}

private fun forceWindowVisibilityVisible(method: MutableMethod) {
    method.addInstructions(
        0,
        """
            invoke-static/range { p1 .. p1 }, $EXTENSION_CLASS->filterWindowVisibility(I)I
            move-result p1
        """.trimIndent(),
    )
}

private fun forceVisibilityAggregatedTrue(method: MutableMethod) {
    method.addInstructions(
        0,
        """
            invoke-static/range { p1 .. p1 }, $EXTENSION_CLASS->filterVisibilityAggregated(Z)Z
            move-result p1
        """.trimIndent(),
    )
}

private fun BytecodePatchContext.suppressCloseSystemDialogsBroadcast(method: MutableMethod) {
    val impl = method.implementation ?: return
    val origP0 = method.p0Register
    val paramRegs = if (origP0 < impl.registerCount) {
        IntArray(impl.registerCount - origP0) { origP0 + it }
    } else {
        intArrayOf()
    }
    val free = runCatching { method.findFreeRegister(0, *paramRegs) }.getOrNull()
    if (free != null && free < 256) {
        method.addInstructions(
            0,
            """
                invoke-static/range { p2 .. p2 }, $EXTENSION_CLASS->shouldSuppressBroadcast(Landroid/content/Intent;)Z
                move-result v$free
                if-eqz v$free, :pinspoof_orig
                return-void
                :pinspoof_orig
                nop
            """.trimIndent(),
        )
        return
    }
    if (impl.registerCount < 250) {
        val cloned = method.cloneParameters()
        val insertIdx = cloned.numberOfParameterRegistersLogical
        val intentReg = "v${origP0 + 2}"
        cloned.addInstructions(
            insertIdx,
            """
                invoke-static/range { $intentReg .. $intentReg }, $EXTENSION_CLASS->shouldSuppressBroadcast(Landroid/content/Intent;)Z
                move-result p0
                if-eqz p0, :pinspoof_orig
                return-void
                :pinspoof_orig
                nop
            """.trimIndent(),
        )
    }
}

private fun BytecodePatchContext.suppressAudioFocusLoss(method: MutableMethod) {
    prepareEntryScratch(method) { freeReg, _, p1Reg ->
        """
            invoke-static/range { $p1Reg .. $p1Reg }, $EXTENSION_CLASS->shouldSuppressAudioFocusLoss(I)Z
            move-result $freeReg
            if-eqz $freeReg, :pinspoof_orig
            return-void
            :pinspoof_orig
            nop
        """.trimIndent()
    }
}

private fun BytecodePatchContext.bypassActivityLifecycleMethod(
    method: MutableMethod,
    superType: String,
    methodName: String,
    callSuper: Boolean,
) {
    prepareEntryScratch(method) { freeReg, p0Reg, _ ->
        val superCall = if (callSuper) {
            "invoke-super/range { $p0Reg .. $p0Reg }, $superType->$methodName()V\n"
        } else {
            ""
        }
        """
            invoke-static/range { $p0Reg .. $p0Reg }, $EXTENSION_CLASS->shouldSuppressLifecycle(Landroid/app/Activity;)Z
            move-result $freeReg
            if-eqz $freeReg, :pinspoof_orig
            ${superCall}return-void
            :pinspoof_orig
            nop
        """.trimIndent()
    }
}

private fun BytecodePatchContext.bypassFragmentLifecycleMethod(
    method: MutableMethod,
    superType: String,
    methodName: String,
) {
    prepareEntryScratch(method) { freeReg, p0Reg, _ ->
        """
            invoke-virtual/range { $p0Reg .. $p0Reg }, $superType->getActivity()Landroid/app/Activity;
            move-result-object $freeReg
            invoke-static/range { $freeReg .. $freeReg }, $EXTENSION_CLASS->shouldSuppressLifecycle(Landroid/app/Activity;)Z
            move-result $freeReg
            if-eqz $freeReg, :pinspoof_orig
            invoke-super/range { $p0Reg .. $p0Reg }, $superType->$methodName()V
            return-void
            :pinspoof_orig
            nop
        """.trimIndent()
    }
}

private fun BytecodePatchContext.skipLifecycleCallbackIfNotFinishing(method: MutableMethod) {
    prepareEntryScratch(method) { freeReg, _, p1Reg ->
        """
            invoke-static/range { $p1Reg .. $p1Reg }, $EXTENSION_CLASS->shouldSuppressLifecycle(Landroid/app/Activity;)Z
            move-result $freeReg
            if-eqz $freeReg, :pinspoof_orig
            return-void
            :pinspoof_orig
            nop
        """.trimIndent()
    }
}

private fun BytecodePatchContext.prepareEntryScratch(
    method: MutableMethod,
    buildSmali: (freeReg: String, p0Reg: String, p1Reg: String) -> String,
) {
    val impl = method.implementation ?: return
    val origP0 = method.p0Register
    val paramRegs = if (origP0 < impl.registerCount) {
        IntArray(impl.registerCount - origP0) { origP0 + it }
    } else {
        intArrayOf()
    }
    val free = runCatching { method.findFreeRegister(0, *paramRegs) }.getOrNull()
    if (free != null && free < 256) {
        method.addInstructions(0, buildSmali("v$free", "p0", "p1"))
        return
    }
    if (impl.registerCount < 250) {
        val cloned = method.cloneParameters()
        val insertIdx = cloned.numberOfParameterRegistersLogical
        cloned.addInstructions(
            insertIdx,
            buildSmali("p0", "v$origP0", "v${origP0 + 1}"),
        )
    }
}
