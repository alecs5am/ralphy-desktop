import {
  ArrowLeft,
  ArrowRight,
  Folder,
  FolderOpen,
  MoreHorizontal,
  PanelRight,
} from "lucide-react";
import { useState } from "react";

interface SidebarChromeProps {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack(): void;
  onForward(): void;
}

export function SidebarChrome({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}: SidebarChromeProps) {
  return (
    <div className="sidebar-chrome">
      <div className="sidebar-traffic-space" aria-hidden="true" />
      <nav className="history-controls" aria-label="Navigation history">
        <button
          className="icon-button"
          type="button"
          title="Back"
          aria-label="Back"
          disabled={!canGoBack}
          onClick={onBack}
        >
          <ArrowLeft size={16} strokeWidth={1.5} />
        </button>
        <button
          className="icon-button"
          type="button"
          title="Forward"
          aria-label="Forward"
          disabled={!canGoForward}
          onClick={onForward}
        >
          <ArrowRight size={16} strokeWidth={1.5} />
        </button>
      </nav>
    </div>
  );
}

interface MainHeaderProps {
  breadcrumbs: string[];
  canToggleInspector: boolean;
  inspectorVisible: boolean;
  showChooseLibrary: boolean;
  onChooseLibrary(): void;
  onToggleInspector(): void;
}

export function MainHeader({
  breadcrumbs,
  canToggleInspector,
  inspectorVisible,
  showChooseLibrary,
  onChooseLibrary,
  onToggleInspector,
}: MainHeaderProps) {
  const [actionsOpen, setActionsOpen] = useState(false);
  return (
    <header className="main-header">
      <Folder size={16} strokeWidth={1.5} aria-hidden="true" />
      <nav className="breadcrumbs" aria-label="Current location">
        {breadcrumbs.map((crumb, index) => (
          <span className="breadcrumb" key={`${crumb}-${index}`}>
            {index > 0 && <span className="breadcrumb-separator">/</span>}
            <span>{crumb}</span>
          </span>
        ))}
      </nav>
      <div className="main-header-actions">
        {showChooseLibrary && (
          <button
            className="icon-button"
            type="button"
            title="Choose .ralphy library"
            aria-label="Choose .ralphy library"
            onClick={onChooseLibrary}
          >
            <FolderOpen size={15} strokeWidth={1.5} />
          </button>
        )}
        {!showChooseLibrary && (
          <div className="header-actions-menu-wrap">
            <button
              className={`icon-button${actionsOpen ? " is-active" : ""}`}
              type="button"
              title="Library actions"
              aria-label="Library actions"
              aria-expanded={actionsOpen}
              onClick={() => setActionsOpen((open) => !open)}
            >
              <MoreHorizontal size={16} strokeWidth={1.5} />
            </button>
            {actionsOpen && (
              <div className="header-actions-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setActionsOpen(false);
                    onChooseLibrary();
                  }}
                >
                  <FolderOpen size={14} strokeWidth={1.5} />
                  Change library
                </button>
              </div>
            )}
          </div>
        )}
        <button
          className={`icon-button${inspectorVisible ? " is-active" : ""}`}
          type="button"
          title="Toggle inspector"
          aria-label="Toggle inspector"
          aria-pressed={inspectorVisible}
          disabled={!canToggleInspector}
          onClick={onToggleInspector}
        >
          <PanelRight size={16} strokeWidth={1.5} />
        </button>
      </div>
    </header>
  );
}
