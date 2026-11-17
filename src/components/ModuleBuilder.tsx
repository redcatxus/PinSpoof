import { useMemo, useState } from 'react';
import { Check, Copy, Download, RotateCcw } from 'lucide-react';
import {
  DEFAULT_MODULE_CONFIG,
  type GeneratedFile,
  type ModuleConfig,
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
  const [selectedFileId, setSelectedFileId] = useState<string>('module-kt');
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

  const toggleItems: Array<{
    key: keyof Pick<
      ModuleConfig,
      | 'includeMaterialYouUi'
      | 'hideFocusLoss'
      | 'hideLifecycleLoss'
      | 'hideMultiWindowAndPip'
      | 'hookActivityLockTask'
      | 'hookActivityManagerState'
      | 'hookBinderProxies'
      | 'hookActivityClient'
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
      detail: 'Generate Jetpack Compose settings screen with per-app granular xposedsharedprefs.',
    },
    {
      key: 'hideFocusLoss',
      label: 'Hide Window Focus Loss & WebView Visibility',
      detail: 'Suppress View.dispatchWindowFocusChanged(false), ViewTreeObserver, WebView visibility, and IMPORTANCE_FOREGROUND.',
    },
    {
      key: 'hideLifecycleLoss',
      label: 'Suppress onPause / onStop / Recents Leave',
      detail: 'Block app onUserLeaveHint(), onPause(), onStop(), ActivityLifecycleCallbacks, and LifecycleRegistry ON_PAUSE/ON_STOP.',
    },
    {
      key: 'hideMultiWindowAndPip',
      label: 'Hide Multi-Window & PiP',
      detail: 'Return false for isInMultiWindowMode() and isInPictureInPictureMode().',
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
      key: 'hookBinderProxies',
      label: 'IActivityTaskManager & IActivityManager Proxies',
      detail: 'Intercept direct/hidden Stub$Proxy Binder calls (API 21–36).',
    },
    {
      key: 'hookActivityClient',
      label: 'ActivityClient Token Hooks (API 31–36)',
      detail: 'Cover Android 12–16 ActivityClient lock-task token wrapper.',
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
      label: 'LSPosed Debug Logs',
      detail: 'Emit XposedBridge.log entries on each intercepted pinning or focus call.',
    },
  ];

  return (
    <section id="builder" className="border-b border-slate-800/80 bg-[#0B0F17]">
      <div className="mx-auto max-w-[1280px] px-6 py-12">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-tight text-slate-100">
              02. Xposed Module Builder &amp; Source Explorer
            </h2>
            <p className="mt-1.5 text-sm text-slate-400 max-w-2xl">
              Customize package metadata, Android 16 target SDK, Material 3 Expressive Compose UI,
              focus-loss stealth, and hook defaults. Every change updates the Gradle project live.
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
              <div className="text-xs font-semibold text-slate-300 mb-2.5">
                Features &amp; Granular Hook Defaults
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
