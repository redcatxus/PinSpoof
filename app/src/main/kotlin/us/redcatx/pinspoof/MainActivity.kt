package us.redcatx.pinspoof

import android.content.Intent
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
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AccessibilityNew
import androidx.compose.material.icons.rounded.Analytics
import androidx.compose.material.icons.rounded.Android
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.AspectRatio
import androidx.compose.material.icons.rounded.AutoFixHigh
import androidx.compose.material.icons.rounded.Cast
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Checklist
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Code
import androidx.compose.material.icons.rounded.ContentPaste
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Fingerprint
import androidx.compose.material.icons.rounded.Language
import androidx.compose.material.icons.rounded.LayersClear
import androidx.compose.material.icons.rounded.PauseCircleOutline
import androidx.compose.material.icons.rounded.PhonelinkLock
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.ScreenRotation
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material.icons.rounded.Upload
import androidx.compose.material.icons.rounded.VerifiedUser
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material.icons.rounded.VolumeUp
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
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
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import us.redcatx.pinspoof.prefs.GranularHookState
import us.redcatx.pinspoof.prefs.HookLogEntry
import us.redcatx.pinspoof.prefs.HookPreset
import us.redcatx.pinspoof.prefs.HookStats
import us.redcatx.pinspoof.prefs.PrefsManager
import us.redcatx.pinspoof.ui.PinSpoofTheme

data class InstalledAppItem(
    val label: String,
    val packageName: String,
    val hasOverride: Boolean,
    val hitTotal: Long
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

@OptIn(
    ExperimentalMaterial3Api::class,
    ExperimentalMaterial3ExpressiveApi::class,
    ExperimentalLayoutApi::class
)
@Composable
private fun PinSpoofControlScreen(prefsManager: PrefsManager) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
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
    var eventLog by remember(selectedPkg) { mutableStateOf(prefsManager.loadEventLog(selectedPkg)) }
    var showAppPicker by remember { mutableStateOf(false) }
    var showEventLogSheet by remember { mutableStateOf(false) }
    var eventLogFilter by remember { mutableStateOf("all") }
    var morpheOptionsTarget by remember { mutableStateOf<Pair<String, GranularHookState>?>(null) }

    DisposableEffect(prefsManager, selectedPkg, lifecycleOwner) {
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ ->
            stats = prefsManager.loadStats(selectedPkg)
            eventLog = prefsManager.loadEventLog(selectedPkg)
        }
        val lifecycleObserver = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                stats = prefsManager.loadStats(selectedPkg)
                eventLog = prefsManager.loadEventLog(selectedPkg)
            }
        }
        prefsManager.registerStatsListener(listener)
        lifecycleOwner.lifecycle.addObserver(lifecycleObserver)
        onDispose {
            prefsManager.unregisterStatsListener(listener)
            lifecycleOwner.lifecycle.removeObserver(lifecycleObserver)
        }
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
                            text = HookConfig.MODULE_TAG,
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
            // Material You Cohesive Scope Selector Card + JSON Export/Import
            item {
                ElevatedCard(
                    shape = RoundedCornerShape(28.dp),
                    colors = CardDefaults.elevatedCardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceContainerLow
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
                                        .background(MaterialTheme.colorScheme.secondaryContainer),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(
                                        imageVector = Icons.Rounded.Apps,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.onSecondaryContainer
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
                                shape = RoundedCornerShape(16.dp),
                                colors = ButtonDefaults.filledTonalButtonColors(
                                    containerColor = MaterialTheme.colorScheme.secondaryContainer,
                                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer
                                )
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
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            OutlinedButton(
                                onClick = {
                                    val base = selectedPkg ?: "global"
                                    exportLauncher.launch("pinspoof-$base.json")
                                },
                                shape = RoundedCornerShape(16.dp),
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                                colors = ButtonDefaults.outlinedButtonColors(
                                    contentColor = MaterialTheme.colorScheme.onSurface
                                ),
                                contentPadding = PaddingValues(0.dp),
                                modifier = Modifier
                                    .weight(1f)
                                    .height(44.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.Upload,
                                    contentDescription = "Export JSON",
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                            OutlinedButton(
                                onClick = { importLauncher.launch(arrayOf("application/json", "text/plain")) },
                                shape = RoundedCornerShape(16.dp),
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                                colors = ButtonDefaults.outlinedButtonColors(
                                    contentColor = MaterialTheme.colorScheme.onSurface
                                ),
                                contentPadding = PaddingValues(0.dp),
                                modifier = Modifier
                                    .weight(1f)
                                    .height(44.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.Download,
                                    contentDescription = "Import JSON",
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                            OutlinedButton(
                                onClick = { morpheOptionsTarget = selectedLabel to hookState },
                                shape = RoundedCornerShape(16.dp),
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                                colors = ButtonDefaults.outlinedButtonColors(
                                    contentColor = MaterialTheme.colorScheme.onSurface
                                ),
                                contentPadding = PaddingValues(0.dp),
                                modifier = Modifier
                                    .weight(1f)
                                    .height(44.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.Checklist,
                                    contentDescription = "Morphe Patching Options",
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }

                        if (selectedPkg != null) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text(
                                    text = "Custom rule saved for this app",
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

            // Live Hook Event Counter Card (tappable tiles open Live Hook Event Log drawer)
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
                            horizontalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.Analytics,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary
                            )
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = "Live Hook Event Counter",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Text(
                                    text = if (selectedPkg == null) {
                                        "Tap a tile for method log · ${stats.cloakBypassed} cloak"
                                    } else {
                                        "$selectedLabel · Tap a tile for method log"
                                    },
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                            IconButton(
                                onClick = {
                                    prefsManager.resetStats(selectedPkg)
                                    stats = HookStats()
                                    eventLog = prefsManager.loadEventLog(selectedPkg)
                                    scope.launch {
                                        snackbarHostState.showSnackbar("Reset event counters")
                                    }
                                }
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.Refresh,
                                    contentDescription = "Reset event counters",
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            StatTile(
                                label = "Pinning",
                                count = stats.pinBlocked,
                                onClick = {
                                    eventLogFilter = "pin"
                                    showEventLogSheet = true
                                },
                                modifier = Modifier.weight(1f)
                            )
                            StatTile(
                                label = "Focus",
                                count = stats.focusHidden,
                                onClick = {
                                    eventLogFilter = "focus"
                                    showEventLogSheet = true
                                },
                                modifier = Modifier.weight(1f)
                            )
                            StatTile(
                                label = "WebView",
                                count = stats.webviewSpoofed,
                                onClick = {
                                    eventLogFilter = "webview"
                                    showEventLogSheet = true
                                },
                                modifier = Modifier.weight(1f)
                            )
                            StatTile(
                                label = "Lifecycle",
                                count = stats.lifecycleHidden,
                                onClick = {
                                    eventLogFilter = "lifecycle"
                                    showEventLogSheet = true
                                },
                                modifier = Modifier.weight(1f)
                            )
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
                            subtitle = "Force View.VISIBLE, block WebView.onPause()/pauseTimers()/onVisibilityAggregated(false), and spoof JS visibility/blur",
                            checked = hookState.hideWebViewVisibility,
                            onCheckedChange = { v -> updateState { it.copy(hideWebViewVisibility = v) } }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.PauseCircleOutline,
                            title = "Suppress onPause / onStop",
                            subtitle = "Block Activity/Fragment/LifecycleRegistry transitions to hide Recents & switching (disable or use Light preset if a SurfaceView/game stalls)",
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

            // Expanded Display, Clipboard, Insets & Media Bypass Card
            item {
                ElevatedCard(shape = RoundedCornerShape(28.dp)) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Text(
                            text = "Display, Media & UI Bypass",
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
                            icon = Icons.Rounded.Cast,
                            title = "Virtual Display & Casting Bypass",
                            subtitle = "Expose only Display.DEFAULT_DISPLAY in DisplayManager and filter external display callbacks",
                            checked = hookState.bypassVirtualDisplays,
                            onCheckedChange = { v -> updateState { it.copy(bypassVirtualDisplays = v) } }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.ContentPaste,
                            title = "Unblock Clipboard Clear",
                            subtitle = "Suppress ClipboardManager.clearPrimaryClip() and blank clip wipes inside scoped apps",
                            checked = hookState.unblockClipboard,
                            onCheckedChange = { v -> updateState { it.copy(unblockClipboard = v) } }
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

            // Deeper Anti-Detection, Sensors, Signature & Integrity Cloaking Card
            item {
                ElevatedCard(shape = RoundedCornerShape(28.dp)) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Text(
                            text = "Anti-Detection & Integrity Cloaking",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold
                        )

                        ExpressiveToggleRow(
                            icon = Icons.Rounded.Security,
                            title = "Cloak Packages & Play Installer",
                            subtitle = "Report com.android.vending as installer and hide Xposed / LSPosed / Morphe packages",
                            checked = hookState.cloakPackagesInstaller,
                            onCheckedChange = { v -> updateState { it.copy(cloakPackagesInstaller = v) } }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.Code,
                            title = "Sanitize Stack Traces",
                            subtitle = "Strip Xposed, LSPHooker, EdHooker, and PinSpoof frames from Thread/Throwable stack traces",
                            checked = hookState.sanitizeStackTraces,
                            onCheckedChange = { v -> updateState { it.copy(sanitizeStackTraces = v) } }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.ScreenRotation,
                            title = "Spoof Motion Sensors (Stationary)",
                            subtitle = "Clamp accelerometer, gyroscope, and significant-motion sensors to resting desk readings",
                            checked = hookState.spoofMotionSensors,
                            onCheckedChange = { v -> updateState { it.copy(spoofMotionSensors = v) } }
                        )
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.Fingerprint,
                            title = "Spoof Package Signature",
                            subtitle = "Return original signing certificate bytes on PackageInfo.signatures / SigningInfo queries",
                            checked = hookState.spoofPackageSignature,
                            onCheckedChange = { v -> updateState { it.copy(spoofPackageSignature = v) } }
                        )
                        AnimatedVisibility(visible = hookState.spoofPackageSignature) {
                            OutlinedTextField(
                                value = hookState.spoofSignatureHex,
                                onValueChange = { hex -> updateState { it.copy(spoofSignatureHex = hex) } },
                                label = { Text("Original Certificate DER Hex (optional)") },
                                placeholder = { Text("3082...") },
                                singleLine = true,
                                textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                                shape = RoundedCornerShape(16.dp),
                                modifier = Modifier.fillMaxWidth()
                            )
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
                        ExpressiveToggleRow(
                            icon = Icons.Rounded.VerifiedUser,
                            title = "Play Integrity / SafetyNet Soft-Fail",
                            subtitle = "Clear local Integrity / attestation Task exceptions to prevent hard client crashes",
                            checked = hookState.softFailIntegrity,
                            onCheckedChange = { v -> updateState { it.copy(softFailIntegrity = v) } }
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

    // Inline Expandable App Rules + Per-App Presets Sheet
    if (showAppPicker) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)
        val pickerListState = rememberLazyListState()
        val navBottomPadding = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
        var query by remember { mutableStateOf("") }
        var appFilter by remember { mutableStateOf("all") }
        var expandedPkg by remember { mutableStateOf<String?>(selectedPkg) }
        val appStatesMap = remember { mutableStateMapOf<String, GranularHookState>() }
        val overrideMap = remember { mutableStateMapOf<String, Boolean>() }

        val installedApps = remember {
            val pm = context.packageManager
            val launchablePkgs = runCatching {
                val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                pm.queryIntentActivities(intent, 0).mapNotNullTo(HashSet()) { it.activityInfo?.packageName }
            }.getOrDefault(emptySet())

            pm.getInstalledApplications(PackageManager.GET_META_DATA)
                .asSequence()
                .mapNotNull { info ->
                    val pName = info.packageName
                    if (pName == HookConfig.MODULE_PKG || pName == "android") return@mapNotNull null
                    val hasCustom = prefsManager.hasPerAppOverride(pName)
                    val hitTotal = prefsManager.getPackageHitTotal(pName)
                    val isUserOrLaunchable = (info.flags and ApplicationInfo.FLAG_SYSTEM) == 0 ||
                        pName in launchablePkgs ||
                        hasCustom ||
                        hitTotal > 0L
                    if (!isUserOrLaunchable) return@mapNotNull null
                    overrideMap[pName] = hasCustom
                    InstalledAppItem(
                        label = pm.getApplicationLabel(info).toString(),
                        packageName = pName,
                        hasOverride = hasCustom,
                        hitTotal = hitTotal
                    )
                }
                .sortedWith(compareBy<InstalledAppItem> { it.label.lowercase() }.thenBy { it.packageName })
                .toList()
        }

        val modifiedCount = remember(overrideMap.toMap()) {
            installedApps.count { overrideMap[it.packageName] == true }
        }
        val activeHitsCount = remember(installedApps) {
            installedApps.count { it.hitTotal > 0L }
        }

        val filtered = remember(query, appFilter, installedApps, overrideMap.toMap()) {
            installedApps.filter { app ->
                val matchesTab = when (appFilter) {
                    "modified" -> overrideMap[app.packageName] == true
                    "active" -> app.hitTotal > 0L
                    else -> true
                }
                if (!matchesTab) return@filter false
                if (query.isBlank()) true
                else app.label.contains(query, ignoreCase = true) ||
                    app.packageName.contains(query, ignoreCase = true)
            }
        }

        ModalBottomSheet(
            onDismissRequest = { showAppPicker = false },
            sheetState = sheetState
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Text(
                        text = "Select App for Granular Override",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = "Tap any app to expand inline presets and save individual rules",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
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
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        FilterChip(
                            selected = appFilter == "all",
                            onClick = { appFilter = "all" },
                            label = { Text("All (${installedApps.size})") }
                        )
                        FilterChip(
                            selected = appFilter == "modified",
                            onClick = { appFilter = "modified" },
                            label = { Text("Modified ($modifiedCount)") }
                        )
                        FilterChip(
                            selected = appFilter == "active",
                            onClick = { appFilter = "active" },
                            label = { Text("Active Hits ($activeHitsCount)") }
                        )
                    }
                }

                Spacer(Modifier.height(10.dp))

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .layout { measurable, constraints ->
                            val offsetPx = runCatching { sheetState.requireOffset() }
                                .getOrNull()
                                ?.takeIf { !it.isNaN() }
                                ?.roundToInt()
                                ?.coerceAtLeast(0)
                                ?: 0
                            val visibleHeight = (constraints.maxHeight - offsetPx)
                                .coerceIn(0, constraints.maxHeight)
                            val placeable = measurable.measure(
                                constraints.copy(minHeight = 0, maxHeight = visibleHeight)
                            )
                            layout(constraints.maxWidth, constraints.maxHeight) {
                                placeable.place(0, 0)
                            }
                        }
                ) {
                    LazyColumn(
                        state = pickerListState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(
                            start = 20.dp,
                            end = 20.dp,
                            top = 4.dp,
                            bottom = 24.dp + navBottomPadding
                        ),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        items(filtered, key = { it.packageName }) { app ->
                        val isExpanded = expandedPkg == app.packageName
                        val isCustom = overrideMap[app.packageName] == true
                        val appState = appStatesMap.getOrPut(app.packageName) {
                            prefsManager.loadState(app.packageName)
                        }

                        fun saveAppRule(next: GranularHookState) {
                            appStatesMap[app.packageName] = next
                            overrideMap[app.packageName] = true
                            prefsManager.saveState(app.packageName, next)
                            if (selectedPkg == app.packageName) {
                                hookState = next
                                hasOverride = true
                            }
                        }

                        Surface(
                            onClick = {
                                expandedPkg = if (isExpanded) null else app.packageName
                            },
                            shape = RoundedCornerShape(20.dp),
                            color = if (isCustom) {
                                MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.72f)
                            } else {
                                MaterialTheme.colorScheme.surfaceContainerHigh
                            }
                        ) {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 14.dp)
                            ) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(12.dp)
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

                                    if (app.hitTotal > 0L) {
                                        Surface(
                                            shape = RoundedCornerShape(10.dp),
                                            color = MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.8f)
                                        ) {
                                            Text(
                                                text = "${app.hitTotal} hits",
                                                style = MaterialTheme.typography.labelSmall,
                                                fontFamily = FontFamily.Monospace,
                                                color = MaterialTheme.colorScheme.onTertiaryContainer,
                                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                            )
                                        }
                                    }

                                    if (isCustom) {
                                        val presetTag = appState.matchingPreset()?.label ?: "Custom"
                                        Surface(
                                            shape = RoundedCornerShape(10.dp),
                                            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.16f)
                                        ) {
                                            Text(
                                                text = presetTag,
                                                style = MaterialTheme.typography.labelSmall,
                                                fontWeight = FontWeight.SemiBold,
                                                color = MaterialTheme.colorScheme.primary,
                                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                                            )
                                        }
                                    }

                                    Icon(
                                        imageVector = if (isExpanded) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore,
                                        contentDescription = if (isExpanded) "Collapse rules" else "Expand rules",
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }

                                AnimatedVisibility(visible = isExpanded) {
                                    Column(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(top = 14.dp),
                                        verticalArrangement = Arrangement.spacedBy(10.dp)
                                    ) {
                                        HorizontalDivider(
                                            color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f)
                                        )

                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.SpaceBetween
                                        ) {
                                            Column(modifier = Modifier.weight(1f)) {
                                                Text(
                                                    text = "Save Individual App Rule",
                                                    style = MaterialTheme.typography.bodyMedium,
                                                    fontWeight = FontWeight.Medium
                                                )
                                                Text(
                                                    text = if (isCustom) "Uses independent per-app profile" else "Currently inherits Global Defaults",
                                                    style = MaterialTheme.typography.bodySmall,
                                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                                )
                                            }
                                            ExpressiveSwitch(
                                                checked = isCustom,
                                                onCheckedChange = { enabled ->
                                                    overrideMap[app.packageName] = enabled
                                                    prefsManager.setPerAppOverride(app.packageName, enabled)
                                                    val reloaded = prefsManager.loadState(if (enabled) app.packageName else null)
                                                    appStatesMap[app.packageName] = reloaded
                                                    if (enabled) {
                                                        prefsManager.saveState(app.packageName, reloaded)
                                                    }
                                                    if (selectedPkg == app.packageName) {
                                                        hasOverride = enabled
                                                        hookState = reloaded
                                                    }
                                                }
                                            )
                                        }

                                        Text(
                                            text = "Per-App Preset Profile",
                                            style = MaterialTheme.typography.labelMedium,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                                            HookPreset.entries.forEachIndexed { idx, preset ->
                                                val presetSelected = isCustom && appState == appState.withPreset(preset)
                                                SegmentedButton(
                                                    selected = presetSelected,
                                                    onClick = { saveAppRule(appState.withPreset(preset)) },
                                                    shape = SegmentedButtonDefaults.itemShape(
                                                        index = idx,
                                                        count = HookPreset.entries.size
                                                    )
                                                ) {
                                                    Text(preset.label, maxLines = 1)
                                                }
                                            }
                                        }

                                        InlineAppRuleSwitch(
                                            title = "Disable Pinning & Spoof Pinned",
                                            checked = appState.masterEnabled,
                                            onCheckedChange = { v -> saveAppRule(appState.copy(masterEnabled = v)) }
                                        )
                                        InlineAppRuleSwitch(
                                            title = "Window Focus Spoofing (Safe)",
                                            checked = appState.hideFocusLoss,
                                            onCheckedChange = { v -> saveAppRule(appState.copy(hideFocusLoss = v)) }
                                        )
                                        InlineAppRuleSwitch(
                                            title = "WebView JS & Visibility Stealth",
                                            checked = appState.hideWebViewVisibility,
                                            onCheckedChange = { v -> saveAppRule(appState.copy(hideWebViewVisibility = v)) }
                                        )
                                        InlineAppRuleSwitch(
                                            title = "Suppress onPause / onStop",
                                            checked = appState.hideLifecycleLoss,
                                            onCheckedChange = { v -> saveAppRule(appState.copy(hideLifecycleLoss = v)) }
                                        )
                                        InlineAppRuleSwitch(
                                            title = "Strip FLAG_SECURE",
                                            checked = appState.stripFlagSecure,
                                            onCheckedChange = { v -> saveAppRule(appState.copy(stripFlagSecure = v)) }
                                        )
                                        InlineAppRuleSwitch(
                                            title = "Cloak Packages & Stack Traces",
                                            checked = appState.cloakPackagesInstaller || appState.sanitizeStackTraces,
                                            onCheckedChange = { v ->
                                                saveAppRule(
                                                    appState.copy(
                                                        cloakPackagesInstaller = v,
                                                        sanitizeStackTraces = v
                                                    )
                                                )
                                            }
                                        )

                                        OutlinedButton(
                                            onClick = { morpheOptionsTarget = app.label to appState },
                                            shape = RoundedCornerShape(14.dp),
                                            modifier = Modifier.fillMaxWidth()
                                        ) {
                                            Icon(Icons.Rounded.Checklist, null, modifier = Modifier.size(16.dp))
                                            Spacer(Modifier.size(8.dp))
                                            Text("Morphe Patching Options")
                                        }

                                        FilledTonalButton(
                                            onClick = {
                                                if (!isCustom) {
                                                    saveAppRule(appState)
                                                }
                                                selectedPkg = app.packageName
                                                selectedLabel = app.label
                                                hookState = prefsManager.loadState(app.packageName)
                                                hasOverride = true
                                                showAppPicker = false
                                            },
                                            shape = RoundedCornerShape(14.dp),
                                            modifier = Modifier.fillMaxWidth()
                                        ) {
                                            Text("Open All Controls & JSON")
                                        }
                                    }
                                }
                            }
                        }
                    }
                    }
                }
            }
        }
    }

    // Live Hook Event Log Drawer (opened by tapping any StatTile)
    if (showEventLogSheet) {
        val logSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)
        val logListState = rememberLazyListState()
        val navBottomPadding = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
        val filterChips = listOf(
            "all" to "All",
            "pin" to "Pinning",
            "focus" to "Focus",
            "webview" to "WebView",
            "lifecycle" to "Lifecycle",
            "cloak" to "Cloaking"
        )
        val filteredEntries = remember(eventLog, eventLogFilter) {
            if (eventLogFilter == "all") eventLog
            else eventLog.filter { it.category == eventLogFilter }
        }
        val timeFmt = remember { DateFormat.getTimeInstance(DateFormat.MEDIUM) }

        LaunchedEffect(eventLogFilter) {
            logListState.scrollToItem(0)
        }

        ModalBottomSheet(
            onDismissRequest = { showEventLogSheet = false },
            sheetState = logSheetState
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Live Hook Event Log",
                                style = MaterialTheme.typography.titleLarge,
                                fontWeight = FontWeight.SemiBold
                            )
                            Text(
                                text = selectedPkg ?: "All scoped apps",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        IconButton(
                            onClick = {
                                prefsManager.resetStats(selectedPkg)
                                stats = HookStats()
                                eventLog = prefsManager.loadEventLog(selectedPkg)
                            }
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.Refresh,
                                contentDescription = "Reset event log"
                            )
                        }
                    }

                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        filterChips.forEach { (id, label) ->
                            FilterChip(
                                selected = eventLogFilter == id,
                                onClick = { eventLogFilter = id },
                                label = { Text(label) }
                            )
                        }
                    }

                    FilledTonalButton(
                        onClick = {
                            if (eventLog.isEmpty()) {
                                scope.launch {
                                    snackbarHostState.showSnackbar("No recorded hits yet — launch the target app first")
                                }
                                return@FilledTonalButton
                            }
                            val (prunedState, disabledCount) = hookState.pruneUnusedHooks(eventLog)
                            updateState { prunedState }
                            scope.launch {
                                snackbarHostState.showSnackbar(
                                    if (disabledCount > 0) {
                                        "Kept active hooks for $selectedLabel · disabled $disabledCount unused"
                                    } else {
                                        "All enabled hooks already have active hits"
                                    }
                                )
                            }
                        },
                        enabled = eventLog.isNotEmpty(),
                        shape = RoundedCornerShape(14.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.AutoFixHigh,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(Modifier.size(8.dp))
                        Text("Keep Active Only (Prune 0-Hit Hooks)")
                    }
                }

                Spacer(Modifier.height(10.dp))

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .layout { measurable, constraints ->
                            val offsetPx = runCatching { logSheetState.requireOffset() }
                                .getOrNull()
                                ?.takeIf { !it.isNaN() }
                                ?.roundToInt()
                                ?.coerceAtLeast(0)
                                ?: 0
                            val visibleHeight = (constraints.maxHeight - offsetPx)
                                .coerceIn(0, constraints.maxHeight)
                            val placeable = measurable.measure(
                                constraints.copy(minHeight = 0, maxHeight = visibleHeight)
                            )
                            layout(constraints.maxWidth, constraints.maxHeight) {
                                placeable.place(0, 0)
                            }
                        }
                ) {
                    if (filteredEntries.isEmpty()) {
                        Surface(
                            shape = RoundedCornerShape(18.dp),
                            color = MaterialTheme.colorScheme.surfaceContainerHigh,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 20.dp)
                        ) {
                            Text(
                                text = "No hook events recorded for this filter yet. Launch a scoped target app and trigger pinning or focus transitions.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(16.dp)
                            )
                        }
                    } else {
                        LazyColumn(
                            state = logListState,
                            modifier = Modifier.fillMaxSize(),
                            contentPadding = PaddingValues(
                                start = 20.dp,
                                end = 20.dp,
                                top = 4.dp,
                                bottom = 24.dp + navBottomPadding
                            ),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            items(
                                items = filteredEntries,
                                key = { "${it.pkg}|${it.category}|${it.method}" }
                            ) { entry ->
                                EventLogRow(entry = entry, formattedTime = timeFmt.format(Date(entry.timestampMs)))
                            }
                        }
                    }
                }
            }
        }
    }

    // Morphe Patching Options Checklist Dialog
    morpheOptionsTarget?.let { (targetTitle, targetState) ->
        val checklist = remember(targetState) { targetState.toMorpheChecklist() }

        AlertDialog(
            onDismissRequest = { morpheOptionsTarget = null },
            title = {
                Column {
                    Text("Morphe Patching Options", fontWeight = FontWeight.SemiBold)
                    Text(
                        text = targetTitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            },
            text = {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 420.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = if (targetState.masterEnabled) {
                            "Enable these toggles in Morphe Manager under PinSpoof Patching Options:"
                        } else {
                            "Master switch is OFF for this config — all hooks are shown OFF:"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    checklist.forEach { (optName, optValue) ->
                        val isActiveVal = optValue == "ON" || optValue.startsWith("Always")
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = optName,
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier
                                    .weight(1f)
                                    .padding(end = 8.dp)
                            )
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = if (isActiveVal) {
                                    MaterialTheme.colorScheme.primaryContainer
                                } else {
                                    MaterialTheme.colorScheme.surfaceContainerHighest
                                }
                            ) {
                                Text(
                                    text = optValue,
                                    style = MaterialTheme.typography.labelSmall,
                                    fontFamily = FontFamily.Monospace,
                                    color = if (isActiveVal) {
                                        MaterialTheme.colorScheme.onPrimaryContainer
                                    } else {
                                        MaterialTheme.colorScheme.onSurfaceVariant
                                    },
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                                )
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { morpheOptionsTarget = null }) {
                    Text("Close")
                }
            }
        )
    }
}

@Composable
private fun StatTile(
    label: String,
    count: Long,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                text = count.toString(),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace
            )
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1
            )
        }
    }
}

@Composable
private fun EventLogRow(entry: HookLogEntry, formattedTime: String) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    text = entry.method,
                    style = MaterialTheme.typography.bodyMedium,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = "${entry.pkg} · $formattedTime",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Surface(
                shape = RoundedCornerShape(10.dp),
                color = MaterialTheme.colorScheme.secondaryContainer
            ) {
                Text(
                    text = "×${entry.count}",
                    style = MaterialTheme.typography.labelMedium,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                )
            }
        }
    }
}

@Composable
private fun InlineAppRuleSwitch(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.weight(1f)
        )
        ExpressiveSwitch(checked = checked, onCheckedChange = onCheckedChange)
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
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(
                    if (checked) MaterialTheme.colorScheme.secondaryContainer
                    else MaterialTheme.colorScheme.surfaceContainerHighest
                ),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = if (checked) MaterialTheme.colorScheme.onSecondaryContainer
                else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp)
            )
        }
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
