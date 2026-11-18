import { useMemo, useState } from 'react';
import { Check, Copy, Download, RotateCcw } from 'lucide-react';
import {
  applyPresetToConfig,
  DEFAULT_MODULE_CONFIG,
  type GeneratedFile,
  type ModuleConfig,
  type PresetProfileId,
} from '../types/moduleConfig';
import { generateProjectFiles } from '../utils/projectGenerator';

interface ModuleBuilderProps {
  config: ModuleConfig;
  onChangeConfig: (next: ModuleConfig) => void;
  onDownloadZip: () => void;
  isDownloading: boolean;
}

export function ModuleBuilder({
  config,
  onChangeConfig,
  onDownloadZip,
  isDownloading,
}: ModuleBuilderProps) {
  const files: GeneratedFile[] = useMemo(() => generateProjectFiles(config), [config]);
  const [selectedFileId, setSelectedFileId] = useState<string>('morphe-patch-kt');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const activeFile = files.find((f) => f.id === selectedFileId) ?? files[0];
  const lines = useMemo(() => activeFile.content.split('\n'), [activeFile.content]);

  const updateField = <K extends keyof ModuleConfig>(key: K, value: ModuleConfig[K]) => {
    onChangeConfig({ ...config, [key]: value });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setCopiedId(activeFile.id);
      window.setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Clipboard API unavailable in restricted contexts
    }
  };

  const presets: Array<{ id: PresetProfileId; label: string }> = [
    { id: 'light', label: 'Light' },
    { id: 'balanced', label: 'Balanced' },
    { id: 'aggressive', label: 'Aggressive' },
  ];

  const toggleItems: Array<{
    key: keyof Pick<
      ModuleConfig,
      | 'includeMaterialYouUi'
      | 'hideFocusLoss'
      | 'hideWebViewVisibility'
      | 'hideLifecycleLoss'
      | 'hideMultiWindowAndPip'
      | 'spoofPinnedInsets'
      | 'stripFlagSecure'
      | 'hideAccessibilityAndOverlays'
      | 'retainAudioFocus'
      | 'hookActivityLockTask'
      | 'hookActivityManagerState'
      | 'hookActivityClient'
      | 'hookBinderProxies'
      | 'hookSettingsLockToApp'
      | 'hookDevicePolicyPermitted'
      | 'debugLogging'
    >;
    label: string;
    detail: string;
  }> = [
    {
      key: 'includeMaterialYouUi',
      label: 'In-App Material 3 Expressive + Material You UI',
      detail: 'Compose UI with Light/Balanced/Aggressive presets, JSON import/export & live counters.',
    },
    {
      key: 'hideFocusLoss',
      label: 'Window Focus Spoofing (Safe Default)',
      detail: 'Drop onWindowFocusChanged(false), topResumed(false), onUserLeaveHint(), and IMPORTANCE_FOREGROUND.',
    },
    {
      key: 'hideWebViewVisibility',
      label: 'WebView Visibility, JS & Pause Stealth',
      detail: 'Split out for stability: force View.VISIBLE, block WebView.onPause(), inject Page Visibility JS.',
    },
    {
      key: 'hideLifecycleLoss',
      label: 'Suppress onPause / onStop (Advanced)',
      detail: 'OFF by default: blocking Activity/LifecycleRegistry transitions can freeze SurfaceView graphics.',
    },
    {
      key: 'hideMultiWindowAndPip',
      label: 'Hide Multi-Window & PiP',
      detail: 'Return false for isInMultiWindowMode() and isInPictureInPictureMode().',
    },
    {
      key: 'spoofPinnedInsets',
      label: 'Simulate Pinned Window Insets',
      detail: 'Report zeroed system bar WindowInsets while keeping your navigation bar & gestures working.',
    },
    {
      key: 'stripFlagSecure',
      label: 'Strip FLAG_SECURE',
      detail: 'Clear FLAG_SECURE on Windows and SurfaceViews for screenshots and troubleshooting.',
    },
    {
      key: 'hideAccessibilityAndOverlays',
      label: 'Hide Accessibility & Overlay Checks',
      detail: 'Return empty AccessibilityManager service list and Settings.canDrawOverlays() = false.',
    },
    {
      key: 'retainAudioFocus',
      label: 'Retain Audio Focus',
      detail: 'Suppress negative AudioManager.OnAudioFocusChangeListener notifications.',
    },
    {
      key: 'hookActivityLockTask',
      label: 'Activity.startLockTask / stopLockTask',
      detail: 'Swallow public pinning calls before IPC leaves the app process.',
    },
    {
      key: 'hookActivityManagerState',
      label: 'ActivityManager State Spoof',
      detail: 'Return LOCK_TASK_MODE_PINNED (2) and isInLockTaskMode() = true.',
    },
    {
      key: 'hookActivityClient',
      label: 'ActivityClient Wrapper (API 31–36)',
      detail: 'Dynamic method scan safe across One UI / HyperOS / ColorOS ROMs.',
    },
    {
      key: 'hookBinderProxies',
      label: 'Binder Stub$Proxy Interception (Advanced)',
      detail: 'OFF by default: dynamically scans IActivityTaskManager & IActivityManager IPC proxies.',
    },
    {
      key: 'hookSettingsLockToApp',
      label: 'Settings.System lock_to_app_enabled',
      detail: 'Report screen pinning as enabled (1) if the app checks Settings.',
    },
    {
      key: 'hookDevicePolicyPermitted',
      label: 'DevicePolicyManager.isLockTaskPermitted',
      detail: 'Optional spoof returning true for the scoped package.',
    },
    {
      key: 'debugLogging',
      label: 'Verbose Debug Logs (Morphe / LSPosed)',
      detail: 'Emit Log.d / XposedBridge.log entries on intercepted pinning or focus calls.',
    },
  ];

  return (
    <section id="builder" className="border-b border-slate-800/80 bg-[#0B0F17]">
      <div className="mx-auto max-w-[1280px] px-6 py-12">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-tight text-slate-100">
              02. Morphe Patch &amp; Xposed Module Builder
            </h2>
            <p className="mt-1.5 text-sm text-slate-400 max-w-2xl">
              Configure v{config.versionName} defaults for both Morphe Patching Options and the
              app-scoped Xposed APK. Every toggle updates the Morphe bundle and Gradle project live.
            </p>
          </div>

          <button
            type="button"
            onClick={() => onChangeConfig(DEFAULT_MODULE_CONFIG)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-800 bg-slate-900 text-xs font-medium text-slate-300 hover:text-white hover:border-slate-700 transition-colors cursor-pointer self-start whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Reset Defaults</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Configurator */}
          <div className="lg:col-span-4 rounded-lg border border-slate-800 bg-[#111827] p-5 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
              <div>
                <label
                  htmlFor="module-name"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Module Name
                </label>
                <input
                  id="module-name"
                  type="text"
                  value={config.moduleName}
                  onChange={(e) => updateField('moduleName', e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-900/90 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="package-name"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Application Package ID
                </label>
                <input
                  id="package-name"
                  type="text"
                  value={config.packageName}
                  onChange={(e) => updateField('packageName', e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-900/90 px-3 py-2 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="min-sdk"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Min SDK
                </label>
                <select
                  id="min-sdk"
                  value={config.minSdk}
                  onChange={(e) => updateField('minSdk', Number(e.target.value))}
                  className="w-full rounded-md border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs font-mono text-slate-100 focus:border-emerald-500 focus:outline-none"
                >
                  <option value={21}>21 (Android 5.0)</option>
                  <option value={24}>24 (Android 7.0)</option>
                  <option value={26}>26 (Android 8.0)</option>
                  <option value={29}>29 (Android 10)</option>
                  <option value={31}>31 (Android 12)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="target-sdk"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Target / Compile SDK
                </label>
                <select
                  id="target-sdk"
                  value={config.targetSdk}
                  onChange={(e) => updateField('targetSdk', Number(e.target.value))}
                  className="w-full rounded-md border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs font-mono text-slate-100 focus:border-emerald-500 focus:outline-none"
                >
                  <option value={34}>34 (Android 14)</option>
                  <option value={35}>35 (Android 15)</option>
                  <option value={36}>36 (Android 16)</option>
                </select>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800">
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <span className="text-xs font-semibold text-slate-300">One-Tap Presets</span>
                <div className="flex items-center gap-1">
                  {presets.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => onChangeConfig(applyPresetToConfig(config, p.id))}
                      className="px-2 py-1 rounded border border-slate-700 bg-slate-900 text-[11px] font-medium text-slate-300 hover:text-emerald-300 hover:border-emerald-600/50 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                {toggleItems.map((item) => (
                  <label
                    key={item.key}
                    className="flex items-start gap-2.5 cursor-pointer group"
                  >
                    <input
                      type="checkbox"
                      checked={config[item.key]}
                      onChange={(e) => updateField(item.key, e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0 cursor-pointer"
                    />
                    <span className="text-xs leading-snug">
                      <span className="block font-medium text-slate-200 group-hover:text-white">
                        {item.label}
                      </span>
                      <span className="block text-slate-400 mt-0.5">{item.detail}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800">
              <label
                htmlFor="recommended-scopes"
                className="block text-xs font-medium text-slate-300 mb-1"
              >
                Recommended Scope Packages (Optional)
              </label>
              <p className="text-xs text-slate-400 mb-2">
                Leave empty so LSPosed lets you pick any desired app freely.{' '}
                <code className="font-mono text-slate-300">android</code> is always excluded.
              </p>
              <textarea
                id="recommended-scopes"
                rows={2}
                placeholder="com.example.targetapp"
                value={config.recommendedScopes}
                onChange={(e) => updateField('recommendedScopes', e.target.value)}
                className="w-full rounded-md border border-slate-700 bg-slate-900/90 px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Right Code Explorer */}
          <div className="lg:col-span-8 rounded-lg border border-slate-800 bg-[#0D131F] overflow-hidden">
            {/* Scrollable File Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-800 bg-[#111827] px-3 py-2 code-scroll">
              {files.map((file) => {
                const isActive = file.id === activeFile.id;
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => setSelectedFileId(file.id)}
                    className={`px-3 py-1.5 rounded text-xs font-mono transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      isActive
                        ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40'
                        : 'text-slate-400 hover:text-slate-200 border border-transparent'
                    }`}
                  >
                    {file.label}
                  </button>
                );
              })}
            </div>

            {/* File Path & Actions Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-2.5 bg-[#0F1624]">
              <div className="flex items-center gap-2 text-xs text-slate-400 font-mono truncate">
                <span className="text-slate-200 truncate">{activeFile.path}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums shrink-0">{lines.length} lines</span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-600 hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {copiedId === activeFile.id ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Copy File</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={onDownloadZip}
                  disabled={isDownloading}
                  className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Export .zip</span>
                </button>
              </div>
            </div>

            {/* Code Viewport */}
            <div className="max-h-[680px] overflow-auto code-scroll bg-[#0B101B] p-4 text-xs leading-6 font-mono">
              <table className="w-full border-collapse">
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={index} className="hover:bg-slate-900/50">
                      <td className="select-none pr-4 text-right text-slate-600 tabular-nums align-top w-10">
                        {index + 1}
                      </td>
                      <td className="text-slate-200 whitespace-pre">{line || ' '}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
