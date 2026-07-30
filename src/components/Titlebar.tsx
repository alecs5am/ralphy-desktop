import {
  ArrowLeft,
  ArrowRight,
  Folder,
  FolderOpen,
  MoreHorizontal,
  PanelBottom,
  PanelLeft,
  PanelRight,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";

interface SidebarChromeProps {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack(): void;
  onForward(): void;
  onToggleSidebar(): void;
}

export function SidebarChrome({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onToggleSidebar,
}: SidebarChromeProps) {
  return (
    <div className="sidebar-chrome">
      <div className="sidebar-chrome-leading">
        <div className="sidebar-traffic-space" aria-hidden="true" />
        <button
          className="icon-button"
          type="button"
          title="Hide sidebar"
          aria-label="Toggle sidebar"
          aria-pressed="true"
          onClick={onToggleSidebar}
        >
          <PanelLeft size={16} strokeWidth={1.5} />
        </button>
      </div>
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
  sidebarVisible: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  rightPanelVisible: boolean;
  bottomPanelVisible: boolean;
  showChooseLibrary: boolean;
  onBack(): void;
  onForward(): void;
  onToggleSidebar(): void;
  onChooseLibrary(): void;
  onToggleRightPanel(): void;
  onToggleBottomPanel(): void;
}

export function MainHeader({
  breadcrumbs,
  sidebarVisible,
  canGoBack,
  canGoForward,
  rightPanelVisible,
  bottomPanelVisible,
  showChooseLibrary,
  onBack,
  onForward,
  onToggleSidebar,
  onChooseLibrary,
  onToggleRightPanel,
  onToggleBottomPanel,
}: MainHeaderProps) {
  const [actionsOpen, setActionsOpen] = useState(false);
  return (
    <motion.header className="main-header" layout>
      {!sidebarVisible && (
        <div className="collapsed-window-controls">
          <div className="main-traffic-space" aria-hidden="true" />
          <button
            className="icon-button"
            type="button"
            title="Show sidebar"
            aria-label="Toggle sidebar"
            aria-pressed="false"
            onClick={onToggleSidebar}
          >
            <PanelLeft size={16} strokeWidth={1.5} />
          </button>
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
        </div>
      )}
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
          className={`icon-button${rightPanelVisible ? " is-active" : ""}`}
          type="button"
          title="Toggle right panel"
          aria-label="Toggle right panel"
          aria-pressed={rightPanelVisible}
          onClick={onToggleRightPanel}
        >
          <PanelRight size={16} strokeWidth={1.5} />
        </button>
        <button
          className={`icon-button${bottomPanelVisible ? " is-active" : ""}`}
          type="button"
          title="Toggle bottom panel"
          aria-label="Toggle bottom panel"
          aria-pressed={bottomPanelVisible}
          onClick={onToggleBottomPanel}
        >
          <PanelBottom size={16} strokeWidth={1.5} />
        </button>
      </div>
    </motion.header>
  );
}
