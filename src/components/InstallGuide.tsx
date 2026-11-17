interface InstallGuideProps {
  packageName: string;
  moduleName: string;
  targetSdk: number;
}

export function InstallGuide({ packageName, moduleName, targetSdk }: InstallGuideProps) {
  const steps = [
    {
      index: '01.',
      title: 'Compile the APK (Local or GitHub Actions)',
      body: `Export the ZIP and open it in Android Studio Meerkat (SDK ${targetSdk}) to build an APK, or push the folder to GitHub where the included .github/workflows/build-apk.yml compiles Debug and Release APKs automatically.`,
    },
    {
      index: '02.',
      title: 'Scope Only Desired Target Apps',
      body: `Install the APK and open LSPosed Manager -> Modules -> ${moduleName}. Toggle the module on and check only the specific apps you want to affect. Leave System Framework (android) unchecked.`,
    },
    {
      index: '03.',
      title: 'Configure Granular Controls In-App',
      body: `Open the ${moduleName} app (Material 3 Expressive + Material You UI). Adjust Global Defaults or pick specific installed apps for custom focus-stealth, reactive/always-pinned mode, and individual hook switches.`,
    },
    {
      index: '04.',
      title: 'Force-Stop & Relaunch Target Apps',
      body: `No device reboot is needed. Force-stop the target app after changing scope or preferences, then relaunch it and confirm "[${moduleName}][<target.pkg>]" entries in LSPosed Logs.`,
    },
  ];

  return (
    <section id="deploy-guide" className="bg-[#0D131F]">
      <div className="mx-auto max-w-[1280px] px-6 py-12">
        <div className="mb-8">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-slate-100">
            03. Build APK &amp; LSPosed Deployment Guide
          </h2>
          <p className="mt-1.5 text-sm text-slate-400 max-w-2xl">
            How to compile <code className="font-mono text-slate-300">{packageName}</code> for
            Android 7–16 without scoping <code className="font-mono text-slate-300">system_server</code>.
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
            Focus-Loss Stealth &amp; App-Process Boundary
          </h3>
          <p className="mt-2 text-xs text-slate-400 leading-relaxed max-w-4xl">
            When you switch away from a scoped app or pull down the notification shade, WindowManager
            notifies <code className="font-mono text-slate-300">DecorView.onWindowFocusChanged(false)</code>{' '}
            and <code className="font-mono text-slate-300">Activity.performTopResumedActivityChanged(false)</code>{' '}
            inside the app process. PinSpoof drops those <code className="font-mono text-slate-300">false</code>{' '}
            callbacks before they reach the app&apos;s Activity subclass, returns{' '}
            <code className="font-mono text-slate-300">true</code> from{' '}
            <code className="font-mono text-slate-300">hasWindowFocus()</code>, and forces{' '}
            <code className="font-mono text-slate-300">ActivityManager.getMyMemoryState()</code> to report{' '}
            <code className="font-mono text-slate-300">IMPORTANCE_FOREGROUND</code> without breaking
            Android&apos;s <code className="font-mono text-slate-300">onPause</code> Binder acks.
          </p>
        </div>
      </div>
    </section>
  );
}
