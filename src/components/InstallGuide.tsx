interface InstallGuideProps {
  packageName: string;
  moduleName: string;
  versionName: string;
  targetSdk: number;
}

export function InstallGuide({
  packageName,
  moduleName,
  versionName,
  targetSdk,
}: InstallGuideProps) {
  const apkName = `${moduleName}-v${versionName}.apk`;
  const mppName = `${moduleName}-v${versionName}.mpp`;

  const steps = [
    {
      index: '01.',
      title: `Build v${versionName} Artifacts in CI`,
      body: `Push to GitHub and .github/workflows/build-apk.yml compiles both ${mppName} + patches-list.json and ${apkName} (SDK ${targetSdk}).`,
    },
    {
      index: '02.',
      title: 'Patch Any APK via Morphe',
      body: `Import ${mppName} in Morphe Manager, enable ${moduleName}, and configure Patching Options (Reactive default, cloaking, stack/sensor/display bypass, signature DER hex, and integrity soft-fail).`,
    },
    {
      index: '03.',
      title: 'Or Deploy App-Scoped via LSPosed',
      body: `Install ${apkName}, enable ${moduleName} in LSPosed for target apps only (never System Framework), and tap any app in Select App Override to expand inline presets and rules.`,
    },
    {
      index: '04.',
      title: 'Prune Hooks & Export Morphe CLI',
      body: `Tap Live Hook Event Counter tiles to prune 0-hit hooks via Keep Active Only, or copy per-app settings as Morphe CLI -O flags and checklists.`,
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
            v{versionName} Stability, Cloaking &amp; Recents Stealth Architecture
          </h3>
          <p className="mt-2 text-xs text-slate-400 leading-relaxed max-w-4xl">
            By default, {moduleName} v{versionName} uses the{' '}
            <strong className="text-slate-200">Balanced</strong> profile (
            <code className="font-mono text-slate-300">spoofTiming=reactive</code>,{' '}
            <code className="font-mono text-slate-300">hideFocusLoss=true</code>,{' '}
            <code className="font-mono text-slate-300">hideWebViewVisibility=true</code>,{' '}
            <code className="font-mono text-slate-300">hideLifecycleLoss=true</code>, and{' '}
            <code className="font-mono text-slate-300">hookBinderProxies=false</code>) so Recents and
            app switching remain hidden even in strict WebView apps. Use the{' '}
            <strong className="text-slate-200">Light</strong> preset or{' '}
            <strong className="text-slate-200">Keep Active Only</strong> pruning if a{' '}
            <code className="font-mono text-slate-300">SurfaceView</code> game stalls on resume, and
            enable cloaking, virtual display &amp; clipboard bypass, or signature spoofing as needed.
          </p>
        </div>
      </div>
    </section>
  );
}
