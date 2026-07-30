import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  PanelRight,
} from "lucide-react";

interface TitlebarProps {
  breadcrumbs: string[];
  canGoBack: boolean;
  canGoForward: boolean;
  canToggleInspector: boolean;
  inspectorVisible: boolean;
  onBack(): void;
  onForward(): void;
  onChooseLibrary(): void;
  onToggleInspector(): void;
}

export function Titlebar({
  breadcrumbs,
  canGoBack,
  canGoForward,
  canToggleInspector,
  inspectorVisible,
  onBack,
  onForward,
  onChooseLibrary,
  onToggleInspector,
}: TitlebarProps) {
  return (
    <header className="titlebar">
      <div className="titlebar-traffic-space" aria-hidden="true" />
      <nav className="history-controls" aria-label="Navigation history">
        <button
          className="icon-button"
          type="button"
          title="Back"
          aria-label="Back"
          disabled={!canGoBack}
          onClick={onBack}
        >
          <ChevronLeft size={16} strokeWidth={1.8} />
        </button>
        <button
          className="icon-button"
          type="button"
          title="Forward"
          aria-label="Forward"
          disabled={!canGoForward}
          onClick={onForward}
        >
          <ChevronRight size={16} strokeWidth={1.8} />
        </button>
      </nav>

      <div className="breadcrumbs" aria-label="Current location">
        <span className="brand-mark" aria-hidden="true">R</span>
        {breadcrumbs.map((crumb, index) => (
          <span className="breadcrumb" key={`${crumb}-${index}`}>
            {index > 0 && <ChevronRight size={12} aria-hidden="true" />}
            <span>{crumb}</span>
          </span>
        ))}
      </div>

      <div className="titlebar-actions">
        <button
          className="icon-button"
          type="button"
          title="Choose .ralphy library"
          aria-label="Choose .ralphy library"
          onClick={onChooseLibrary}
        >
          <FolderOpen size={15} strokeWidth={1.8} />
        </button>
        <button
          className={`icon-button${inspectorVisible ? " is-active" : ""}`}
          type="button"
          title="Toggle inspector"
          aria-label="Toggle inspector"
          aria-pressed={inspectorVisible}
          disabled={!canToggleInspector}
          onClick={onToggleInspector}
        >
          <PanelRight size={15} strokeWidth={1.8} />
        </button>
      </div>
    </header>
  );
}
