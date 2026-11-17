export function OverviewStrip() {
  return (
    <section id="overview" className="border-b border-slate-800/80 bg-[#0B0F17]">
      <div className="mx-auto max-w-[1280px] px-6 py-12 lg:py-16">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mb-4">
            <span>Xposed API 82 / LSPosed 93+</span>
            <span aria-hidden="true">·</span>
            <span>App-Process Scope Only</span>
            <span aria-hidden="true">·</span>
            <span>Android 7.0 – 16 (API 24 – 36)</span>
          </div>

          <h1
            className="font-display text-3xl sm:text-4xl lg:text-[42px] font-semibold tracking-tight text-slate-50 leading-[1.15]"
            style={{ textWrap: 'balance' }}
          >
            Disable system app pinning, spoof LockTask state, and hide focus loss inside scoped apps
          </h1>

          <p className="mt-4 text-base text-slate-300 leading-relaxed max-w-2xl">
            Intercepts <code className="font-mono text-sm text-emerald-300">startLockTask()</code>,{' '}
            <code className="font-mono text-sm text-emerald-300">stopLockTask()</code>, Binder IPC
            proxies, and window focus callbacks inside the target app&apos;s own ART process before
            anything reaches <code className="font-mono text-sm text-slate-200">system_server</code>.
            Includes an in-app Material 3 Expressive &amp; Material You settings interface with
            per-app granular toggles via <code className="font-mono text-sm text-slate-200">xposedsharedprefs</code>.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-slate-800 rounded-lg bg-[#111827]/70 divide-y sm:divide-y-0 sm:divide-x divide-slate-800">
          <div className="p-5">
            <div className="text-xs font-medium text-slate-400">Required LSPosed Scope</div>
            <div className="mt-1.5 text-lg font-semibold text-slate-100">Target Apps Only</div>
            <div className="mt-1 text-xs text-slate-400">
              System Framework (<code className="font-mono text-slate-300">android</code>) stays unchecked
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
            <div className="text-xs font-medium text-slate-400">Focus Stealth Surfaces</div>
            <div className="mt-1.5 text-lg font-semibold text-slate-100">Window &amp; Lifecycle</div>
            <div className="mt-1 text-xs text-slate-400">
              <code className="font-mono text-slate-300">DecorView</code>,{' '}
              <code className="font-mono text-slate-300">topResumed</code>,{' '}
              <code className="font-mono text-slate-300">IMPORTANCE_FOREGROUND</code>
            </div>
          </div>

          <div className="p-5">
            <div className="text-xs font-medium text-slate-400">Target SDK &amp; UI</div>
            <div className="mt-1.5 text-lg font-semibold text-slate-100 tabular-nums">
              API 24 – 36 (Android 16)
            </div>
            <div className="mt-1 text-xs text-slate-400">
              Material 3 Expressive + Material You Compose controls
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
