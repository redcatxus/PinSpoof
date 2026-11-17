import { useState } from 'react';
import { InstallGuide } from './components/InstallGuide';
import { ModuleBuilder } from './components/ModuleBuilder';
import { OverviewStrip } from './components/OverviewStrip';
import { PinSimulator } from './components/PinSimulator';
import { TopBar } from './components/TopBar';
import { DEFAULT_MODULE_CONFIG, type ModuleConfig } from './types/moduleConfig';
import { downloadProjectZip } from './utils/projectGenerator';

export default function App() {
  const [config, setConfig] = useState<ModuleConfig>(DEFAULT_MODULE_CONFIG);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownloadZip = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      await downloadProjectZip(config);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0F17] text-slate-100">
      <TopBar onDownloadZip={handleDownloadZip} isDownloading={isDownloading} />

      <main className="flex-1">
        <OverviewStrip />

        <PinSimulator
          spoofTiming={config.spoofTiming}
          hideFocusLoss={config.hideFocusLoss}
          hideLifecycleLoss={config.hideLifecycleLoss}
          onChangeSpoofTiming={(mode) => setConfig((prev) => ({ ...prev, spoofTiming: mode }))}
        />

        <ModuleBuilder
          config={config}
          onChangeConfig={setConfig}
          onDownloadZip={handleDownloadZip}
          isDownloading={isDownloading}
        />

        <InstallGuide
          packageName={config.packageName}
          moduleName={config.moduleName}
          targetSdk={config.targetSdk}
        />
      </main>

      <footer className="border-t border-slate-800/80 bg-[#0B0F17]">
        <div className="mx-auto max-w-[1280px] px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-500">
          <span>
            {config.moduleName} · {config.packageName} · API {config.minSdk}–{config.targetSdk}
          </span>
          <button
            type="button"
            onClick={handleDownloadZip}
            disabled={isDownloading}
            className="text-slate-300 hover:text-emerald-300 transition-colors cursor-pointer whitespace-nowrap"
          >
            Download Gradle Project (.zip)
          </button>
        </div>
      </footer>
    </div>
  );
}
