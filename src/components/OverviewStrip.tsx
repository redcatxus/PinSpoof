export function OverviewStrip() {
  return (
    <section id="overview" className="border-b border-slate-800/80 bg-[#0B0F17]">
      <div className="mx-auto max-w-[1280px] px-6 py-12 lg:py-16">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mb-4">
            <span>PinSpoof v1.5.0 · Morphe Patcher 2.4 &amp; LSPosed API 82</span>
            <span aria-hidden="true">·</span>
            <span>No system_server / No Root via Morphe</span>
            <span aria-hidden="true">·</span>
            <span>Android 7.0 – 16 (API 24 – 36)</span>
          </div>

          <h1
            className="font-display text-3xl sm:text-4xl lg:text-[42px] font-semibold tracking-tight text-slate-50 leading-[1.15]"
            style={{ textWrap: 'balance' }}
          >
            Disable app pinning, spoof LockTask state, and cloak detection safely
          </h1>

          <p className="mt-4 text-base text-slate-300 leading-relaxed max-w-2xl">
            Intercepts <code className="font-mono text-sm text-emerald-300">startLockTask()</code>{' '}
            in <strong className="font-semibold text-slate-100">Reactive</strong> mode by default,
            adds package/stack-trace/sensor cloaking, virtual display &amp; clipboard bypass,
            signature &amp; integrity soft-fail, and ships as{' '}
            <code className="font-mono text-sm text-emerald-300">PinSpoof-v1.5.0.mpp</code> and{' '}
            <code className="font-mono text-sm text-emerald-300">PinSpoof-v1.5.0.apk</code>.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-slate-800 rounded-lg bg-[#111827]/70 divide-y sm:divide-y-0 sm:divide-x divide-slate-800">
          <div className="p-5">
            <div className="text-xs font-medium text-slate-400">Release Artifacts (v1.5.0)</div>
            <div className="mt-1.5 text-lg font-semibold text-slate-100">Morphe &amp; LSPosed</div>
            <div className="mt-1 text-xs text-slate-400">
              <code className="font-mono text-slate-300">PinSpoof-v1.5.0.mpp</code> &amp;{' '}
              <code className="font-mono text-slate-300">.apk</code>
            </div>
          </div>

          <div className="p-5">
            <div className="text-xs font-medium text-slate-400">Anti-Detection Cloaking</div>
            <div className="mt-1.5 text-lg font-semibold text-emerald-400">
              Packages, Stack &amp; Sensors
            </div>
            <div className="mt-1 text-xs text-slate-400">
              Play installer spoof, stack frame filter, calm motion readings
            </div>
          </div>

          <div className="p-5">
            <div className="text-xs font-medium text-slate-400">Display, Media &amp; Tamper</div>
            <div className="mt-1.5 text-lg font-semibold text-slate-100">
              Displays, Clips &amp; Certs
            </div>
            <div className="mt-1 text-xs text-slate-400">
              <code className="font-mono text-slate-300">DisplayManager</code>,{' '}
              <code className="font-mono text-slate-300">ClipboardManager</code>,{' '}
              <code className="font-mono text-slate-300">PackageInfo</code>
            </div>
          </div>

          <div className="p-5">
            <div className="text-xs font-medium text-slate-400">In-App Tools</div>
            <div className="mt-1.5 text-lg font-semibold text-slate-100 tabular-nums">
              Per-App Rules &amp; Logs
            </div>
            <div className="mt-1 text-xs text-slate-400">
              Inline app rule dropdowns + tappable method event log
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
