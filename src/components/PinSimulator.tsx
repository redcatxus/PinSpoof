import { useState } from 'react';
import { CheckCircle2, EyeOff, RotateCcw, ShieldOff, XCircle } from 'lucide-react';
import type { SpoofTimingMode } from '../types/moduleConfig';

interface TraceEntry {
  step: number;
  call: string;
  stockResult: string;
  spoofResult: string;
}

interface PinSimulatorProps {
  spoofTiming: SpoofTimingMode;
  hideFocusLoss: boolean;
  hideLifecycleLoss: boolean;
  onChangeSpoofTiming: (mode: SpoofTimingMode) => void;
}

export function PinSimulator({
  spoofTiming,
  hideFocusLoss,
  hideLifecycleLoss,
  onChangeSpoofTiming,
}: PinSimulatorProps) {
  const [stockPinned, setStockPinned] = useState(false);
  const [spoofedPinned, setSpoofedPinned] = useState(spoofTiming === 'always');
  const [backgrounded, setBackgrounded] = useState(false);
  const [lastCallLabel, setLastCallLabel] = useState('Idle — waiting for app call');
  const [trace, setTrace] = useState<TraceEntry[]>([]);

  const effectiveSpoofState = spoofTiming === 'always' || spoofedPinned;
  const stockHasFocus = !backgrounded;
  const spoofHasFocus = hideFocusLoss ? true : !backgrounded;

  const appendTrace = (entry: Omit<TraceEntry, 'step'>) => {
    setTrace((prev) => [{ ...entry, step: prev.length + 1 }, ...prev.slice(0, 7)]);
  };

  const handleCheckInitial = () => {
    const stockState = stockPinned ? 'LOCK_TASK_MODE_PINNED (2)' : 'LOCK_TASK_MODE_NONE (0)';
    const spoofState = effectiveSpoofState
      ? 'LOCK_TASK_MODE_PINNED (2)'
      : 'LOCK_TASK_MODE_NONE (0)';
    setLastCallLabel('ActivityManager.getLockTaskModeState()');
    appendTrace({
      call: 'ActivityManager.getLockTaskModeState()',
      stockResult: stockState,
      spoofResult: spoofState,
    });
  };

  const handleStartLockTask = () => {
    setStockPinned(true);
    setSpoofedPinned(true);
    setLastCallLabel('Activity.startLockTask()');
    appendTrace({
      call: 'Activity.startLockTask()',
      stockResult: 'Binder -> system_server: SystemUI pinning prompt shown',
      spoofResult: 'Swallowed in app process (param.result = null); spoofedPinned = true',
    });
  };

  const handleQueryModeState = () => {
    const stockState = stockPinned ? 'LOCK_TASK_MODE_PINNED (2)' : 'LOCK_TASK_MODE_NONE (0)';
    const spoofState = effectiveSpoofState
      ? 'LOCK_TASK_MODE_PINNED (2)'
      : 'LOCK_TASK_MODE_NONE (0)';
    setLastCallLabel('ActivityManager.getLockTaskModeState()');
    appendTrace({
      call: 'ActivityManager.getLockTaskModeState()',
      stockResult: stockState,
      spoofResult: spoofState,
    });
  };

  const handleQueryIsInLockTask = () => {
    const stockVal = stockPinned ? 'true' : 'false';
    const spoofVal = effectiveSpoofState ? 'true' : 'false';
    setLastCallLabel('ActivityManager.isInLockTaskMode()');
    appendTrace({
      call: 'ActivityManager.isInLockTaskMode()',
      stockResult: stockVal,
      spoofResult: spoofVal,
    });
  };

  const handleSimulateFocusLoss = () => {
    const nextBg = !backgrounded;
    setBackgrounded(nextBg);
    setLastCallLabel(
      nextBg ? 'User opened Recents / switched app' : 'User returned to target app'
    );
    appendTrace({
      call: nextBg
        ? 'Recents / Focus Loss (onUserLeaveHint, onPause, dispatchWindowFocusChanged(false))'
        : 'DecorView.onWindowFocusChanged(true)',
      stockResult: nextBg
        ? 'hasWindowFocus()=false, onPause/onStop fired, IMPORTANCE_CACHED'
        : 'hasWindowFocus()=true, IMPORTANCE_FOREGROUND',
      spoofResult: nextBg
        ? hideFocusLoss && hideLifecycleLoss
          ? 'Dropped false focus, WebView visibility & onPause/onStop/onUserLeaveHint'
          : hideFocusLoss
            ? 'Dropped false focus; onPause/onStop passed through (hideLifecycleLoss off)'
            : hideLifecycleLoss
              ? 'Suppressed onPause/onStop; focus loss passed through (hideFocusLoss off)'
              : 'Focus & lifecycle events passed through'
        : 'hasWindowFocus()=true, IMPORTANCE_FOREGROUND',
    });
  };

  const handleStopLockTask = () => {
    setStockPinned(false);
    if (spoofTiming === 'reactive') {
      setSpoofedPinned(false);
    }
    setLastCallLabel('Activity.stopLockTask()');
    appendTrace({
      call: 'Activity.stopLockTask()',
      stockResult: 'Binder -> system_server: System pinning exited',
      spoofResult:
        spoofTiming === 'always'
          ? 'Swallowed in app process; ALWAYS_SPOOF_PINNED remains true'
          : 'Swallowed in app process; spoofedPinned = false',
    });
  };

  const handleReset = () => {
    setStockPinned(false);
    setSpoofedPinned(spoofTiming === 'always');
    setBackgrounded(false);
    setLastCallLabel('Idle — waiting for app call');
    setTrace([]);
  };

  const handleModeSwitch = (mode: SpoofTimingMode) => {
    onChangeSpoofTiming(mode);
    setSpoofedPinned(mode === 'always');
  };

  return (
    <section id="simulator" className="border-b border-slate-800/80 bg-[#0D131F]">
      <div className="mx-auto max-w-[1280px] px-6 py-12">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-tight text-slate-100">
              01. LockTask &amp; Focus-Stealth Simulator
            </h2>
            <p className="mt-1.5 text-sm text-slate-400 max-w-2xl">
              Step through a target app&apos;s pinning and window-focus lifecycle to compare Stock
              Android against PinSpoof&apos;s app-process hooks.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-slate-800 shrink-0 self-start">
            <button
              type="button"
              onClick={() => handleModeSwitch('reactive')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                spoofTiming === 'reactive'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Reactive (After startLockTask)
            </button>
            <button
              type="button"
              onClick={() => handleModeSwitch('always')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                spoofTiming === 'always'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Always Pinned
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Trigger Controls */}
          <div className="lg:col-span-4 rounded-lg border border-slate-800 bg-[#111827] p-5">
            <div className="text-xs font-semibold text-slate-300 mb-3">
              Target App Invocation Sequence
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleCheckInitial}
                className="w-full text-left px-3.5 py-2.5 rounded-md border border-slate-800 bg-slate-900/80 hover:border-slate-700 hover:bg-slate-800/80 text-xs font-mono text-slate-200 transition-colors cursor-pointer"
              >
                1. getLockTaskModeState() <span className="text-slate-400 font-sans">— pre-check</span>
              </button>
              <button
                type="button"
                onClick={handleStartLockTask}
                className="w-full text-left px-3.5 py-2.5 rounded-md border border-emerald-700/60 bg-emerald-950/40 hover:bg-emerald-900/40 text-xs font-mono text-emerald-300 transition-colors cursor-pointer"
              >
                2. activity.startLockTask() <span className="text-emerald-200/70 font-sans">— trigger pin</span>
              </button>
              <button
                type="button"
                onClick={handleQueryModeState}
                className="w-full text-left px-3.5 py-2.5 rounded-md border border-slate-800 bg-slate-900/80 hover:border-slate-700 hover:bg-slate-800/80 text-xs font-mono text-slate-200 transition-colors cursor-pointer"
              >
                3. getLockTaskModeState() <span className="text-slate-400 font-sans">— verify pin</span>
              </button>
              <button
                type="button"
                onClick={handleQueryIsInLockTask}
                className="w-full text-left px-3.5 py-2.5 rounded-md border border-slate-800 bg-slate-900/80 hover:border-slate-700 hover:bg-slate-800/80 text-xs font-mono text-slate-200 transition-colors cursor-pointer"
              >
                4. isInLockTaskMode() <span className="text-slate-400 font-sans">— legacy check</span>
              </button>
              <button
                type="button"
                onClick={handleSimulateFocusLoss}
                className="w-full text-left px-3.5 py-2.5 rounded-md border border-slate-800 bg-slate-900/80 hover:border-slate-700 hover:bg-slate-800/80 text-xs font-mono text-slate-200 transition-colors cursor-pointer"
              >
                5. {backgrounded ? 'Return to App Focus' : 'Switch App / Pull Shade'}{' '}
                <span className="text-slate-400 font-sans">— focus event</span>
              </button>
              <button
                type="button"
                onClick={handleStopLockTask}
                className="w-full text-left px-3.5 py-2.5 rounded-md border border-slate-800 bg-slate-900/80 hover:border-slate-700 hover:bg-slate-800/80 text-xs font-mono text-slate-200 transition-colors cursor-pointer"
              >
                6. activity.stopLockTask() <span className="text-slate-400 font-sans">— release</span>
              </button>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between gap-2">
              <span className="text-xs text-slate-400 truncate font-mono" title={lastCallLabel}>
                {lastCallLabel}
              </span>
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-700 text-xs text-slate-300 hover:text-white hover:border-slate-600 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                <span>Reset</span>
              </button>
            </div>
          </div>

          {/* Right: Side-by-Side State Comparison & Execution Trace */}
          <div className="lg:col-span-8 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 border border-slate-800 rounded-lg bg-[#111827] divide-y md:divide-y-0 md:divide-x divide-slate-800">
              {/* Stock Android */}
              <div className="p-5">
                <div className="flex items-center justify-between gap-2 mb-4">
                  <span className="text-sm font-semibold text-slate-200">
                    Stock Android (Unscoped)
                  </span>
                  <span className="text-xs text-slate-400 font-mono">IPC -&gt; system_server</span>
                </div>

                <dl className="space-y-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-400">System Screen Pinning</dt>
                    <dd className="inline-flex items-center gap-1.5 font-medium">
                      {stockPinned ? (
                        <>
                          <XCircle className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                          <span className="text-amber-300">Active (Device Locked to App)</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                          <span className="text-slate-300">Inactive</span>
                        </>
                      )}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-400">getLockTaskModeState()</dt>
                    <dd className="font-mono tabular-nums text-slate-200">
                      {stockPinned ? '2 (LOCK_TASK_MODE_PINNED)' : '0 (LOCK_TASK_MODE_NONE)'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-400">hasWindowFocus()</dt>
                    <dd className={`font-mono ${stockHasFocus ? 'text-slate-200' : 'text-amber-300'}`}>
                      {stockHasFocus ? 'true' : 'false (Focus lost)'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-400">getMyMemoryState()</dt>
                    <dd className="font-mono text-slate-300">
                      {stockHasFocus ? 'IMPORTANCE_FOREGROUND (100)' : 'IMPORTANCE_CACHED (400)'}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* PinSpoof App-Scoped */}
              <div className="p-5">
                <div className="flex items-center justify-between gap-2 mb-4">
                  <span className="text-sm font-semibold text-emerald-300">
                    PinSpoof (App-Scoped)
                  </span>
                  <span className="text-xs text-slate-400 font-mono">App ART Process Only</span>
                </div>

                <dl className="space-y-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-400">System Screen Pinning</dt>
                    <dd className="inline-flex items-center gap-1.5 font-medium text-emerald-300">
                      <ShieldOff className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                      <span>Disabled (IPC Swallowed)</span>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-400">getLockTaskModeState()</dt>
                    <dd
                      className={`font-mono tabular-nums ${
                        effectiveSpoofState ? 'text-emerald-300 font-medium' : 'text-slate-300'
                      }`}
                    >
                      {effectiveSpoofState
                        ? '2 (LOCK_TASK_MODE_PINNED)'
                        : '0 (LOCK_TASK_MODE_NONE)'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-400">hasWindowFocus()</dt>
                    <dd
                      className={`inline-flex items-center gap-1.5 font-mono ${
                        spoofHasFocus ? 'text-emerald-300 font-medium' : 'text-amber-300'
                      }`}
                    >
                      {hideFocusLoss && backgrounded && (
                        <EyeOff className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                      )}
                      <span>
                        {spoofHasFocus
                          ? backgrounded
                            ? 'true (Focus loss hidden)'
                            : 'true'
                          : 'false'}
                      </span>
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-400">getMyMemoryState()</dt>
                    <dd className="font-mono text-emerald-300">
                      {spoofHasFocus ? 'IMPORTANCE_FOREGROUND (100)' : 'IMPORTANCE_CACHED (400)'}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>

            {/* Execution Trace Table */}
            <div className="rounded-lg border border-slate-800 bg-[#111827] overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">Execution Trace</span>
                <span className="text-xs text-slate-400 tabular-nums">
                  {trace.length} {trace.length === 1 ? 'event' : 'events'}
                </span>
              </div>

              {trace.length === 0 ? (
                <div className="px-4 py-6 text-xs text-slate-400">
                  Trigger any method on the left to observe how PinSpoof intercepts LockTask Binder
                  IPC and suppresses window focus loss inside the app process.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 text-slate-400 bg-slate-900/50">
                      <tr>
                        <th className="px-4 py-2.5 font-medium w-12">#</th>
                        <th className="px-4 py-2.5 font-medium">Method / Event</th>
                        <th className="px-4 py-2.5 font-medium">Stock Android</th>
                        <th className="px-4 py-2.5 font-medium">PinSpoof Return</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {trace.map((row) => (
                        <tr key={row.step} className="hover:bg-slate-900/40">
                          <td className="px-4 py-2.5 font-mono tabular-nums text-slate-500">
                            {row.step}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-slate-200 whitespace-nowrap">
                            {row.call}
                          </td>
                          <td className="px-4 py-2.5 text-slate-400">{row.stockResult}</td>
                          <td className="px-4 py-2.5 font-mono text-emerald-300">
                            {row.spoofResult}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
