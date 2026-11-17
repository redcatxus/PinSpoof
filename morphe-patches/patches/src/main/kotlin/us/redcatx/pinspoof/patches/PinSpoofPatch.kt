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

@Suppress("unused")
val pinSpoofPatch = bytecodePatch(
    name = "PinSpoof",
    description = "Disables app pinning (LockTask), spoofs pinned state, and hides focus/Recents loss directly in patched APKs without root or Xposed.",
    default = true,
) {
    val spoofTiming by stringOption(
        key = "spoofTiming",
        default = "reactive",
        values = mapOf(
            "Reactive (after startLockTask)" to "reactive",
            "Always Pinned (from launch)" to "always",
        ),
        title = "Spoof Timing Mode",
        description = "Choose whether LockTask state is spoofed only after startLockTask() or always from launch.",
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

    val hideFocusLoss by booleanOption(
        key = "hideFocusLoss",
        default = true,
        title = "Hide Window Focus Loss & WebView Visibility",
        description = "Block onWindowFocusChanged(false), coerce WebView/View window visibility to VISIBLE, and spoof hasWindowFocus() & IMPORTANCE_FOREGROUND.",
    )

    val hideLifecycleLoss by booleanOption(
        key = "hideLifecycleLoss",
        default = true,
        title = "Suppress onPause / onStop / Recents Leave",
        description = "Suppress app onUserLeaveHint(), onPause(), onStop(), ActivityLifecycleCallbacks, WebView.onPause(), and LifecycleRegistry ON_PAUSE/ON_STOP.",
    )

    val hideMultiWindowAndPip by booleanOption(
        key = "hideMultiWindowAndPip",
        default = true,
        title = "Hide Multi-Window & Picture-in-Picture",
        description = "Return false for Activity.isInMultiWindowMode() and isInPictureInPictureMode().",
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
        default = true,
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
            rewriteStaticNoArgOrSwallow(
                methodName = "startLockTaskModeByToken",
                returnType = "V",
                replacement = "$EXTENSION_CLASS->onLockTaskTokenCall()V",
            )
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

        if (hideLifecycleLoss == true) {
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

        if (hideFocusLoss == true || hideLifecycleLoss == true) {
            patchAppSubclassOverrides(
                hideFocus = hideFocusLoss == true,
                hideLifecycle = hideLifecycleLoss == true,
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

private fun BytecodePatchContext.rewriteStaticNoArgOrSwallow(
    methodName: String,
    returnType: String,
    replacement: String,
) {
    methodCall(
        name = methodName,
        returnType = returnType,
    ).matchAllMethodIndicesForEach(requireMatches = false) { index ->
        if (definingClass.startsWith(EXTENSION_PREFIX)) return@matchAllMethodIndicesForEach
        val ref = (getInstruction(index) as? ReferenceInstruction)?.reference as? MethodReference
            ?: return@matchAllMethodIndicesForEach
        if (ref.definingClass == "Landroid/app/ActivityClient;" ||
            ref.definingClass.startsWith("Landroid/app/IActivity")
        ) {
            replaceInstruction(index, "invoke-static {}, $replacement")
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
    hideLifecycle: Boolean,
) {
    val activityTargets = mutableListOf<ClassDef>()
    val fragmentTargets = mutableListOf<ClassDef>()
    val viewTargets = mutableListOf<ClassDef>()
    val lifecycleCallbackTargets = mutableListOf<ClassDef>()
    val focusListenerTargets = mutableListOf<ClassDef>()

    classDefForEach { classDef ->
        val type = classDef.type
        if (isFrameworkType(type)) return@classDefForEach

        if (isActivityType(type)) {
            val hasActivityHook = classDef.methods.any { m ->
                m.implementation != null && (
                    (hideFocus && ((m.name == "onWindowFocusChanged" && m.parameterTypes == listOf("Z") && m.returnType == "V") ||
                        (m.name == "onTopResumedActivityChanged" && m.parameterTypes == listOf("Z") && m.returnType == "V"))) ||
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

        if (hideFocus && isViewType(type)) {
            val hasViewHook = classDef.methods.any { m ->
                m.implementation != null && (
                    (m.name == "onWindowFocusChanged" && m.parameterTypes == listOf("Z") && m.returnType == "V") ||
                        (m.name == "onWindowVisibilityChanged" && m.parameterTypes == listOf("I") && m.returnType == "V")
                    )
            }
            if (hasViewHook) viewTargets += classDef
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
                hideLifecycle &&
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
            if (method.name == "onWindowFocusChanged" &&
                method.parameterTypes == listOf("Z") &&
                method.returnType == "V"
            ) {
                skipWhenBooleanParamFalse(method)
            } else if (method.name == "onWindowVisibilityChanged" &&
                method.parameterTypes == listOf("I") &&
                method.returnType == "V"
            ) {
                forceWindowVisibilityVisible(method)
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

private fun forceWindowVisibilityVisible(method: MutableMethod) {
    method.addInstructions(
        0,
        """
            invoke-static/range { p1 .. p1 }, $EXTENSION_CLASS->filterWindowVisibility(I)I
            move-result p1
        """.trimIndent(),
    )
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
