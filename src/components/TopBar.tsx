import { Download } from 'lucide-react';

interface TopBarProps {
  onDownloadZip: () => void;
  isDownloading: boolean;
}

export function TopBar({ onDownloadZip, isDownloading }: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-[#0B0F17]/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-8 px-6 py-4">
        <a
          href="#overview"
          className="font-display text-lg font-semibold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
        >
          PinSpoof
        </a>

        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-400">
          <a
            href="#overview"
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            Overview
          </a>
          <a
            href="#simulator"
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            Simulator
          </a>
          <a
            href="#builder"
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            Module Builder
          </a>
          <a
            href="#deploy-guide"
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            Deploy Guide
          </a>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onDownloadZip}
            disabled={isDownloading}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{isDownloading ? 'Packaging...' : 'Download Project (.zip)'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
