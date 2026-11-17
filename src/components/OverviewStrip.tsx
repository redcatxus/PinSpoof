export function OverviewStrip() {
  return (
    <section id="overview" className="border-b border-slate-800/80 bg-[#0B0F17]">
      <div className="mx-auto max-w-[1280px] px-6 py-12 lg:py-16">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mb-4">
            <span>Morphe Patcher 2.4 · Xposed API 82 / LSPosed</span>
            <span aria-hidden="true">·</span>
            <span>No system_server / No Root via Morphe</span>
            <span aria-hidden="true">·</span>
            <span>Android 7.0 – 16 (API 24 – 36)</span>
          </div>

          <h1
            className="font-display text-3xl sm:text-4xl lg:text-[42px] font-semibold tracking-tight text-slate-50 leading-[1.15]"
            style={{ textWrap: 'balance' }}
          >
            Disable app pinning, spoof LockTask state, and hide Recents focus loss
          </h1>

          <p className="mt-4 text-base text-slate-300 leading-relaxed max-w-2xl">
            Intercepts <code className="font-mono text-sm text-emerald-300">startLockTask()</code>,{' '}
            <code className="font-mono text-sm text-emerald-300">stopLockTask()</code>, focus
            callbacks, WebView visibility, and{' '}
            <code className="font-mono text-sm text-slate-200">onPause</code> /{' '}
            <code className="font-mono text-sm text-slate-200">onStop</code> transitions. Use it
            via <strong className="font-semibold text-slate-100">Morphe patching</strong> (with
            all controls exposed as Patching Options) or as an app-scoped LSPosed module.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-slate-800 rounded-lg bg-[#111827]/70 divide-y sm:divide-y-0 sm:divide-x divide-slate-800">
          <div className="p-5">
            <div className="text-xs font-medium text-slate-400">Deployment Targets</div>
            <div className="mt-1.5 text-lg font-semibold text-slate-100">Morphe &amp; LSPosed</div>
            <div className="mt-1 text-xs text-slate-400">
              Rootless <code className="font-mono text-slate-300">.mpp</code> patching or
              app-scoped Xposed
            </div>
          </div>

          <div className="p-5">
            <div className="text-xs font-medium text-slate-400">Spoofed LockTask Constant</div>
            <div className="mt-1.5 font-mono text-lg font-semibold text-emerald-400 tabular-nums">
              LOCK_TASK_MODE_PINNED (2)
            </div>
            <div className="mt-1 text-xs text-slate-400">
              Plus <code className="font-mono text-slate-300">isInLockTaskMode() == true</code>
            </div>
          </div>

          <div className="p-5">
            <div className="text-xs font-medium text-slate-400">Focus &amp; Recents Stealth</div>
            <div className="mt-1.5 text-lg font-semibold text-slate-100">Window &amp; Lifecycle</div>
            <div className="mt-1 text-xs text-slate-400">
              <code className="font-mono text-slate-300">onPause</code>,{' '}
              <code className="font-mono text-slate-300">WebView</code>,{' '}
              <code className="font-mono text-slate-300">LifecycleRegistry</code>
            </div>
          </div>

          <div className="p-5">
            <div className="text-xs font-medium text-slate-400">Controls &amp; Options</div>
            <div className="mt-1.5 text-lg font-semibold text-slate-100 tabular-nums">
              Patching Options + UI
            </div>
            <div className="mt-1 text-xs text-slate-400">
              Morphe Manager options + Material You Compose UI
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
