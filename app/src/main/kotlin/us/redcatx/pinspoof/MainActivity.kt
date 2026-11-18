package us.redcatx.pinspoof

import android.content.SharedPreferences
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas as AndroidCanvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AccessibilityNew
import androidx.compose.material.icons.rounded.Analytics
import androidx.compose.material.icons.rounded.Android
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.AspectRatio
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Language
import androidx.compose.material.icons.rounded.LayersClear
import androidx.compose.material.icons.rounded.PauseCircleOutline
import androidx.compose.material.icons.rounded.PhonelinkLock
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material.icons.rounded.Upload
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material.icons.rounded.VolumeUp
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import us.redcatx.pinspoof.prefs.GranularHookState
import us.redcatx.pinspoof.prefs.HookPreset
import us.redcatx.pinspoof.prefs.HookStats
import us.redcatx.pinspoof.prefs.PrefsManager
import us.redcatx.pinspoof.ui.PinSpoofTheme

data class InstalledAppItem(
    val label: String,
    val packageName: String,
    val hasOverride: Boolean
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val prefsManager = PrefsManager(this)
        setContent {
            PinSpoofTheme {
                PinSpoofControlScreen(prefsManager = prefsManager)
            }
        }
    }
}

private fun Drawable.toComposeImageBitmap(sizePx: Int = 128): ImageBitmap {
    if (this is BitmapDrawable && bitmap != null) {
        return bitmap.asImageBitmap()
    }
    val width = if (intrinsicWidth > 0) intrinsicWidth.coerceIn(48, sizePx) else sizePx
    val height = if (intrinsicHeight > 0) intrinsicHeight.coerceIn(48, sizePx) else sizePx
    val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = AndroidCanvas(bmp)
    setBounds(0, 0, canvas.width, canvas.height)
    draw(canvas)
    return bmp.asImageBitmap()
}

@Composable
private fun AppIconView(
    packageName: String,
    contentDescription: String?,
    size: Dp = 44.dp
) {
    val context = LocalContext.current
    val iconBitmap by produceState<ImageBitmap?>(initialValue = null, key1 = packageName) {
        value = withContext(Dispatchers.IO) {
            runCatching {
                context.packageManager.getApplicationIcon(packageName).toComposeImageBitmap()
            }.getOrNull()
        }
    }

    val shape = RoundedCornerShape(14.dp)
    val bmp = iconBitmap
    if (bmp != null) {
        Image(
            bitmap = bmp,
            contentDescription = contentDescription,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .size(size)
                .clip(shape)
        )
    } else {
        Box(
            modifier = Modifier
                .size(size)
                .clip(shape)
                .background(MaterialTheme.colorScheme.surfaceContainerHighest),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Rounded.Android,
                contentDescription = contentDescription,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(size * 0.55f)
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun PinSpoofControlScreen(prefsManager: PrefsManager) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()

    var selectedPkg by remember { mutableStateOf<String?>(null) }
    var selectedLabel by remember { mutableStateOf("Global Defaults") }
    var hookState by remember(selectedPkg) { mutableStateOf(prefsManager.loadState(selectedPkg)) }
    var hasOverride by remember(selectedPkg) {
        mutableStateOf(selectedPkg?.let { prefsManager.hasPerAppOverride(it) } ?: false)
    }
    var stats by remember(selectedPkg) { mutableStateOf(prefsManager.loadStats(selectedPkg)) }
    var showAppPicker by remember { mutableStateOf(false) }

    DisposableEffect(prefsManager, selectedPkg) {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ ->
            stats = prefsManager.loadStats(selectedPkg)
        }
        prefsManager.registerStatsListener(listener)
        onDispose { prefsManager.unregisterStatsListener(listener) }
    }

    fun updateState(transform: (GranularHookState) -> GranularHookState) {
        val next = transform(hookState)
        hookState = next
        prefsManager.saveState(selectedPkg, next)
        if (selectedPkg != null) {
            hasOverride = true
        }
    }

    val exportLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching {
            context.contentResolver.openOutputStream(uri)?.use { stream ->
                stream.write(hookState.toJson(selectedPkg).toByteArray(Charsets.UTF_8))
            }
        }.onSuccess {
            scope.launch { snackbarHostState.showSnackbar("Exported profile JSON") }
        }.onFailure {
            scope.launch { snackbarHostState.showSnackbar("Export failed: ${it.message}") }
        }
    }

    val importLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching {
            val raw = context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
                ?: error("Empty file")
            GranularHookState.fromJson(raw, hookState)
        }.onSuccess { imported ->
            updateState { imported }
            scope.launch { snackbarHostState.showSnackbar("Imported profile JSON") }
        }.onFailure {
            scope.launch { snackbarHostState.showSnackbar("Invalid JSON profile") }
        }
    }

    Scaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            LargeTopAppBar(
                title = {
                    Column {
                        Text(
                            text = "${HookConfig.MODULE_TAG} v1.2.0",
                            style = MaterialTheme.typography.headlineMediumEmphasized,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = if (prefsManager.isWorldReadableActive) {
                                "LSPosed xposedsharedprefs active · App-scoped"
                            } else {
                                "Enable module in LSPosed to sync preferences"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                scrollBehavior = scrollBehavior
            )
        }
    ) { innerPadding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                start = 16.dp,
                end = 16.dp,
                top = innerPadding.calculateTopPadding() + 8.dp,
                bottom = innerPadding.calculateBottomPadding() + 28.dp
            ),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Expressive Scope Selector Card + JSON Export/Import
            item {
                ElevatedCard(
                    shape = RoundedCornerShape(28.dp),
                    colors = CardDefaults.elevatedCardColors(
                        containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f)
                    )
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(14.dp)
                        ) {
                            val activePkg = selectedPkg
                            if (activePkg != null) {
                                AppIconView(
                                    packageName = activePkg,
                                    contentDescription = selectedLabel,
                                    size = 44.dp
                                )
                            } else {
                                Box(
                                    modifier = Modifier
                                        .size(44.dp)
                                        .clip(RoundedCornerShape(14.dp))
                                        .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.16f)),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(
                                        imageVector = Icons.Rounded.Apps,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.primary
                                    )
                                }
                            }
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = selectedLabel,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Spacer(Modifier.height(2.dp))
                                Text(
                                    text = selectedPkg ?: "Applies to all apps in LSPosed scope",
                                    style = MaterialTheme.typography.bodySmall,
                                    fontFamily = if (selectedPkg != null) FontFamily.Monospace else FontFamily.Default,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            FilledTonalButton(
                                onClick = { showAppPicker = true },
                                shape = RoundedCornerShape(16.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.Tune,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp)
                                )
                                Spacer(Modifier.size(8.dp))
                                Text("Select App Override")
                            }

                            if (selectedPkg != null) {
                                TextButton(
                                    onClick = {
                                        selectedPkg?.let { prefsManager.setPerAppOverride(it, false) }
                                        selectedPkg = null
                                        selectedLabel = "Global Defaults"
                                    }
                                ) {
                                    Text("Use Global")
                                }
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            OutlinedButton(
                                onClick = {
                                    val base = selectedPkg ?: "global"
                                    exportLauncher.launch("pinspoof-$base.json")
                                },
                                shape = RoundedCornerShape(14.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Icon(Icons.Rounded.Upload, null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.size(6.dp))
                                Text("Export JSON")
                            }
                            OutlinedButton(
                                onClick = { importLauncher.launch(arrayOf("application/json", "text/plain")) },
                                shape = RoundedCornerShape(14.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Icon(Icons.Rounded.Download, null, modifier = Modifier.size(16.dp))
                                Spacer(Modifier.size(6.dp))
                                Text("Import JSON")
                            }
                        }

                        if (selectedPkg != null) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    text = "Custom override active for this app",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                ExpressiveSwitch(
                                    checked = hasOverride,
                                    onCheckedChange = { enabled ->
                                        selectedPkg?.let {
                                            prefsManager.setPerAppOverride(it, enabled)
                                            hasOverride = enabled
                                            hookState = prefsManager.loadState(if (enabled) it else null)
                                        }
                                    }
                                )
                            }
                        }
                    }
                }
            }

            // Live Hook Event Counter Card
            item {
                ElevatedCard(shape = RoundedCornerShape(28.dp)) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.Analytics,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary
                                )
                                Column {
                                    Text(
                                        text = "Live Hook Event Counter",
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                    Text(
                                        text = if (selectedPkg == null) "All scoped apps combined" else selectedLabel,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                            Row {
                                IconButton(onClick = { stats = prefsManager.loadStats(selectedPkg) }) {
                                    Icon(Icons.Rounded.Refresh, contentDescription = "Refresh counts")
                                }
                                TextButton(onClick = {
                                    prefsManager.resetStats(selectedPkg)
                                    stats = HookStats()
                                }) {
                                    Text("Reset")
                                }
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            StatTile("Pinning", stats.pinBlocked, Modifier.weight(1f))
                            StatTile("Focus", stats.focusHidden, Modifier.weight(1f))
                            StatTile("WebView", stats.webviewSpoofed, Modifier.weight(1f))
                            StatTile("Lifecycle", stats.lifecycleHidden, Modifier.weight(1f))
                        }
                    }
                }
            }

            // One-Tap Preset Profiles + Master LockTask Spoof & Timing Card
            item {
                ElevatedCard(shape = RoundedCornerShape(28.dp)) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                text = "One-Tap Preset Profiles",
                                style = MaterialTheme.typography.labelLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                                HookPreset.entries.forEachIndexed { index, preset ->
                                    val isSelected = hookState == hookState.withPreset(preset)
                                    SegmentedButton(
                                        selected = isSelected,
                                        onClick = {
                                            updateState { it.withPreset(preset) }
                                            scope.launch {
                                                snackbarHostState.showSnackbar("Applied ${preset.label} preset")
                                            }
                                        },
                                        shape = SegmentedButtonDefaults.itemShape(
                                            index = index,
                                            count = HookPreset.entries.size
                                        )
                                    ) {
                                        Text(preset.label)
                                    }
                                }
                            }
                        }

                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))

                        ExpressiveToggleRow(
                            icon = Icons.Rounded.PhonelinkLock,
                            title = "Disable Pinning & Spoof Pinned",
                            subtitle = "Swallow startLockTask() and report LOCK_TASK_MODE_PINNED (2) without system_server scope",
                            checked = hookState.masterEnabled,
                            onCheckedChange = { v -> updateState { it.copy(masterEnabled = v) } }
                        )

                        AnimatedVisibility(visible = hookState.masterEnabled) {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(
                                    text = "Spoof Timing Mode (Reactive recommended)",
                                    style = MaterialTheme.typography.labelLarge,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                                    SegmentedButton(
                                        selected = !hookState.alwaysSpoofPinned,
                                        onClick = { updateState { it.copy(alwaysSpoofPinned = false) } },
                                        shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2)
                                    ) {
                                        Text("Reactive")
                                    }
                                    SegmentedButton(
                                        selected = hookState.alwaysSpoofPinned,
                                        onClick = { updateState { it.copy(alwaysSpoofPinned = true) } },
                                        shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2)
                                    ) {
                                        Text("Always Pinned")
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Focus, WebView & Lifecycle Stealth Card
            item {
                ElevatedCard(shape = RoundedCornerShape(28.dp)) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.VisibilityOff,
                            title = "Window Focus Spoofing (Safe)",
                            subtitle = "Drop onWindowFocusChanged(false), topResumed(false), onUserLeaveHint(), hasWindowFocus() -> true, IMPORTANCE_FOREGROUND",
                            checked = hookState.hideFocusLoss,
                            onCheckedChange = { v -> updateState { it.copy(hideFocusLoss = v) } }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.Language,
                            title = "WebView Visibility, JS & Pause Stealth",
                            subtitle = "Force View.VISIBLE, block WebView.onPause()/pauseTimers(), and spoof JS document.hidden / visibilityState / blur",
                            checked = hookState.hideWebViewVisibility,
                            onCheckedChange = { v -> updateState { it.copy(hideWebViewVisibility = v) } }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.PauseCircleOutline,
                            title = "Suppress onPause / onStop (Advanced)",
                            subtitle = "OFF by default: blocking Activity/LifecycleRegistry transitions can stall SurfaceView/TextureView graphics on resume",
                            checked = hookState.hideLifecycleLoss,
                            onCheckedChange = { v -> updateState { it.copy(hideLifecycleLoss = v) } }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.LayersClear,
                            title = "Hide Multi-Window & PiP",
                            subtitle = "Return false for isInMultiWindowMode() and isInPictureInPictureMode()",
                            checked = hookState.hideMultiWindowPip,
                            onCheckedChange = { v -> updateState { it.copy(hideMultiWindowPip = v) } }
                        )
                    }
                }
            }

            // Modern UI, Window Insets & Environment Stealth Card
            item {
                ElevatedCard(shape = RoundedCornerShape(28.dp)) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Text(
                            text = "Window, Insets & Environment Stealth",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold
                        )

                        ExpressiveToggleRow(
                            icon = Icons.Rounded.AspectRatio,
                            title = "Simulate Pinned Window Insets",
                            subtitle = "Report zeroed system bar WindowInsets while keeping your actual navigation bar & gestures usable",
                            checked = hookState.spoofPinnedInsets,
                            onCheckedChange = { v -> updateState { it.copy(spoofPinnedInsets = v) } }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.Shield,
                            title = "Strip FLAG_SECURE",
                            subtitle = "Clear FLAG_SECURE on Windows and SurfaceViews for screenshots and screen troubleshooting",
                            checked = hookState.stripFlagSecure,
                            onCheckedChange = { v -> updateState { it.copy(stripFlagSecure = v) } }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.AccessibilityNew,
                            title = "Hide Accessibility & Overlay Checks",
                            subtitle = "Return empty AccessibilityManager service list and Settings.canDrawOverlays() = false",
                            checked = hookState.hideAccessibilityOverlays,
                            onCheckedChange = { v -> updateState { it.copy(hideAccessibilityOverlays = v) } }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.VolumeUp,
                            title = "Retain Audio Focus",
                            subtitle = "Suppress negative OnAudioFocusChangeListener events when notifications play",
                            checked = hookState.retainAudioFocus,
                            onCheckedChange = { v -> updateState { it.copy(retainAudioFocus = v) } }
                        )
                    }
                }
            }

            // Granular Hook Surface Matrix
            item {
                ElevatedCard(shape = RoundedCornerShape(28.dp)) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Text(
                            text = "LockTask Hook Surfaces",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold
                        )

                        GranularSwitchItem(
                            title = "Activity.startLockTask / stopLockTask",
                            subtitle = "Intercept public Activity lock-task transitions",
                            checked = hookState.hookActivityLockTask,
                            onCheckedChange = { v -> updateState { it.copy(hookActivityLockTask = v) } }
                        )
                        GranularSwitchItem(
                            title = "ActivityManager State Queries",
                            subtitle = "Spoof getLockTaskModeState() & isInLockTaskMode()",
                            checked = hookState.hookActivityManagerState,
                            onCheckedChange = { v -> updateState { it.copy(hookActivityManagerState = v) } }
                        )
                        GranularSwitchItem(
                            title = "ActivityClient Wrapper (Android 12–16)",
                            subtitle = "Dynamic LockTask token scan safe across OEM ROMs",
                            checked = hookState.hookActivityClient,
                            onCheckedChange = { v -> updateState { it.copy(hookActivityClient = v) } }
                        )
                        GranularSwitchItem(
                            title = "Binder Stub\$Proxy Interception (Advanced)",
                            subtitle = "OFF by default: dynamic Stub\$Proxy scan for apps calling Binder proxies directly",
                            checked = hookState.hookBinderProxies,
                            onCheckedChange = { v -> updateState { it.copy(hookBinderProxies = v) } }
                        )
                        GranularSwitchItem(
                            title = "Settings.System lock_to_app_enabled",
                            subtitle = "Spoof system screen-pinning toggle as enabled (1)",
                            checked = hookState.hookSettingsLockToApp,
                            onCheckedChange = { v -> updateState { it.copy(hookSettingsLockToApp = v) } }
                        )
                        GranularSwitchItem(
                            title = "DevicePolicyManager.isLockTaskPermitted",
                            subtitle = "Report LockTask permission as granted for scoped package",
                            checked = hookState.hookDpmPermitted,
                            onCheckedChange = { v -> updateState { it.copy(hookDpmPermitted = v) } }
                        )
                        GranularSwitchItem(
                            title = "Verbose LSPosed Logging",
                            subtitle = "Emit XposedBridge.log traces for intercepted calls",
                            checked = hookState.debugLogging,
                            onCheckedChange = { v -> updateState { it.copy(debugLogging = v) } }
                        )
                    }
                }
            }
        }
    }

    if (showAppPicker) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        var query by remember { mutableStateOf("") }
        val installedApps = remember {
            val pm = context.packageManager
            pm.getInstalledApplications(PackageManager.GET_META_DATA)
                .asSequence()
                .filter {
                    it.packageName != HookConfig.MODULE_PKG &&
                        it.packageName != "android" &&
                        (it.flags and ApplicationInfo.FLAG_SYSTEM) == 0
                }
                .map {
                    InstalledAppItem(
                        label = pm.getApplicationLabel(it).toString(),
                        packageName = it.packageName,
                        hasOverride = prefsManager.hasPerAppOverride(it.packageName)
                    )
                }
                .sortedWith(compareByDescending<InstalledAppItem> { it.hasOverride }.thenBy { it.label })
                .toList()
        }

        val filtered = remember(query, installedApps) {
            if (query.isBlank()) installedApps
            else installedApps.filter {
                it.label.contains(query, ignoreCase = true) ||
                    it.packageName.contains(query, ignoreCase = true)
            }
        }

        ModalBottomSheet(
            onDismissRequest = { showAppPicker = false },
            sheetState = sheetState
        ) {
            Column(
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = "Select App for Granular Override",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold
                    )
                    OutlinedTextField(
                        value = query,
                        onValueChange = { query = it },
                        placeholder = { Text("Filter by app name or package ID") },
                        leadingIcon = {
                            Icon(
                                imageVector = Icons.Rounded.Search,
                                contentDescription = null
                            )
                        },
                        singleLine = true,
                        shape = RoundedCornerShape(18.dp),
                        modifier = Modifier.fillMaxWidth()
                    )
                }

                Spacer(Modifier.height(14.dp))

                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(420.dp),
                    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    items(filtered, key = { it.packageName }) { app ->
                        Surface(
                            onClick = {
                                selectedPkg = app.packageName
                                selectedLabel = app.label
                                showAppPicker = false
                            },
                            shape = RoundedCornerShape(20.dp),
                            color = if (app.hasOverride) {
                                MaterialTheme.colorScheme.secondaryContainer
                            } else {
                                MaterialTheme.colorScheme.surfaceContainerHigh
                            }
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 14.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(14.dp)
                            ) {
                                AppIconView(
                                    packageName = app.packageName,
                                    contentDescription = app.label,
                                    size = 44.dp
                                )

                                Column(
                                    modifier = Modifier.weight(1f),
                                    verticalArrangement = Arrangement.spacedBy(2.dp)
                                ) {
                                    Text(
                                        text = app.label,
                                        style = MaterialTheme.typography.bodyLarge,
                                        fontWeight = FontWeight.Medium,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    Text(
                                        text = app.packageName,
                                        style = MaterialTheme.typography.bodySmall,
                                        fontFamily = FontFamily.Monospace,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }

                                if (app.hasOverride) {
                                    Surface(
                                        shape = RoundedCornerShape(10.dp),
                                        color = MaterialTheme.colorScheme.primary.copy(alpha = 0.14f)
                                    ) {
                                        Text(
                                            text = "Custom",
                                            style = MaterialTheme.typography.labelSmall,
                                            fontWeight = FontWeight.SemiBold,
                                            color = MaterialTheme.colorScheme.primary,
                                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
                Spacer(Modifier.height(20.dp))
            }
        }
    }
}

@Composable
private fun StatTile(
    label: String,
    count: Long,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                text = count.toString(),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
                color = MaterialTheme.colorScheme.primary
            )
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun ExpressiveToggleRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = if (checked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
        )
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        ExpressiveSwitch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun GranularSwitchItem(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        ExpressiveSwitch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun ExpressiveSwitch(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Switch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        thumbContent = {
            Icon(
                imageVector = if (checked) Icons.Rounded.Check else Icons.Rounded.Close,
                contentDescription = null,
                modifier = Modifier.size(SwitchDefaults.IconSize)
            )
        }
    )
}
