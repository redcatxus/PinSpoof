interface InstallGuideProps {
  packageName: string;
  moduleName: string;
  targetSdk: number;
}

export function InstallGuide({ packageName, moduleName, targetSdk }: InstallGuideProps) {
  const steps = [
    {
      index: '01.',
      title: 'Build via GitHub Actions CI',
      body: `Push to GitHub and .github/workflows/build-apk.yml compiles both ${moduleName}-morphe-patches (patches-*.mpp + patches-list.json) and ${moduleName}-apks (SDK ${targetSdk}).`,
    },
    {
      index: '02.',
      title: 'Patch Any APK in Morphe Manager',
      body: `Open Morphe Manager -> Patches -> Select from storage (.mpp), pick any target APK, and open Patching Options to configure every feature (pin spoof, focus stealth, Recents suppression).`,
    },
    {
      index: '03.',
      title: 'Or Deploy App-Scoped via LSPosed',
      body: `Prefer runtime hooking? Install the APK, enable ${moduleName} in LSPosed for target apps only (leave System Framework unchecked), and use the Material You app UI.`,
    },
    {
      index: '04.',
      title: 'Install & Verify Recents Stealth',
      body: `Install the Morphe-patched APK (or force-stop the LSPosed-scoped app). Screen pinning is disabled while getLockTaskModeState() stays 2 and Recents switches stay hidden.`,
    },
  ];

  return (
    <section id="deploy-guide" className="bg-[#0D131F]">
      <div className="mx-auto max-w-[1280px] px-6 py-12">
        <div className="mb-8">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-slate-100">
            03. Morphe Patching &amp; LSPosed Deployment
          </h2>
          <p className="mt-1.5 text-sm text-slate-400 max-w-2xl">
            Every control in <code className="font-mono text-slate-300">{packageName}</code> works
            both as Morphe Patching Options (no root/Xposed needed) and as an app-scoped LSPosed
            module.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 border border-slate-800 rounded-lg bg-[#111827] divide-y md:divide-y-0 md:divide-x divide-slate-800">
          {steps.map((step) => (
            <div key={step.index} className="p-5">
              <div className="font-mono text-xs font-semibold text-emerald-400 tabular-nums">
                {step.index}
              </div>
              <h3 className="mt-2 font-display text-base font-semibold text-slate-100">
                {step.title}
              </h3>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-lg border border-slate-800 bg-[#111827] p-5">
          <h3 className="font-display text-sm font-semibold text-slate-200">
            Morphe Bytecode Patching Options &amp; Recents Stealth
          </h3>
          <p className="mt-2 text-xs text-slate-400 leading-relaxed max-w-4xl">
            During Morphe patching, all in-app toggles map 1:1 to{' '}
            <code className="font-mono text-slate-300">PinSpoofPatch</code> options (
            <code className="font-mono text-slate-300">spoofTiming</code>,{' '}
            <code className="font-mono text-slate-300">hookActivityLockTask</code>,{' '}
            <code className="font-mono text-slate-300">hookActivityManagerState</code>,{' '}
            <code className="font-mono text-slate-300">hideFocusLoss</code>,{' '}
            <code className="font-mono text-slate-300">hideLifecycleLoss</code>,{' '}
            <code className="font-mono text-slate-300">hideMultiWindowAndPip</code>,{' '}
            <code className="font-mono text-slate-300">hookSettingsLockToApp</code>,{' '}
            <code className="font-mono text-slate-300">hookDevicePolicyPermitted</code>,{' '}
            <code className="font-mono text-slate-300">debugLogging</code>). Bytecode hooks
            rewrite <code className="font-mono text-slate-300">Activity</code>,{' '}
            <code className="font-mono text-slate-300">WebView</code>,{' '}
            <code className="font-mono text-slate-300">Fragment</code>,{' '}
            <code className="font-mono text-slate-300">ActivityLifecycleCallbacks</code>, and{' '}
            <code className="font-mono text-slate-300">LifecycleRegistry</code> directly inside
            the patched APK&apos;s DEX files.
          </p>
        </div>
      </div>
    </section>
  );
}
