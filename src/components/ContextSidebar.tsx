import {
  Boxes,
  ChevronDown,
  CircleDollarSign,
  Folder,
  FolderKanban,
  FolderOpen,
  Layers3,
  Pin,
  Search,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectSummary,
  WorkspaceSummary,
} from "../lib/ipc";
import {
  sortProjects,
  sortWorkspaces,
  type WorkbenchRoute,
} from "../state/workbench";
import { SidebarChrome } from "./Titlebar";

interface ContextSidebarProps {
  route: WorkbenchRoute;
  rootPath: string;
  workspaces: WorkspaceSummary[];
  projects: ProjectSummary[];
  pinnedWorkspaceIds: string[];
  pinnedProjectIds: string[];
  searchRequest: number;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack(): void;
  onForward(): void;
  onChooseLibrary(): void;
  onOpenLibrary(): void;
  onOpenWorkspace(workspaceId: string): void;
  onOpenProject(project: ProjectSummary): void;
  onToggleWorkspacePin(workspaceId: string): void;
  onToggleProjectPin(projectId: string): void;
}

function includesQuery(query: string, ...values: string[]): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || values.some((value) => value.toLocaleLowerCase().includes(needle));
}

function relativeActivity(value: string): string {
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed) || elapsed < 0) return "now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d` : new Date(value).toLocaleDateString();
}

function initials(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase();
}

function PinButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      className={`row-pin${active ? " is-pinned" : ""}`}
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <Pin size={13} fill={active ? "currentColor" : "none"} />
    </button>
  );
}

export function ContextSidebar({
  route,
  rootPath,
  workspaces,
  projects,
  pinnedWorkspaceIds,
  pinnedProjectIds,
  searchRequest,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onChooseLibrary,
  onOpenLibrary,
  onOpenWorkspace,
  onOpenProject,
  onToggleWorkspacePin,
  onToggleProjectPin,
}: ContextSidebarProps) {
  const [query, setQuery] = useState("");
  const [searchVisible, setSearchVisible] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(12);
  const searchRef = useRef<HTMLInputElement>(null);
  const workspaceId = route.kind === "library" ? null : route.workspaceId;
  const workspace = workspaces.find((item) => item.id === workspaceId);

  useEffect(() => {
    setQuery("");
    setSearchVisible(false);
    setVisibleLimit(12);
  }, [workspaceId]);

  useEffect(() => {
    if (searchVisible) searchRef.current?.focus();
  }, [searchVisible]);

  useEffect(() => {
    if (searchRequest === 0) return;
    setSearchVisible(true);
    window.requestAnimationFrame(() => searchRef.current?.focus());
  }, [searchRequest]);

  const visibleWorkspaces = useMemo(
    () =>
      sortWorkspaces(
        workspaces.filter((item) => includesQuery(query, item.name, item.description)),
        pinnedWorkspaceIds,
      ),
    [pinnedWorkspaceIds, query, workspaces],
  );
  const visibleProjects = useMemo(
    () =>
      sortProjects(
        projects.filter(
          (item) =>
            item.workspaceId === workspaceId &&
            includesQuery(query, item.name, item.brief, item.status, item.phase ?? ""),
        ),
        pinnedProjectIds,
      ),
    [pinnedProjectIds, projects, query, workspaceId],
  );
  const visibleItems = workspace ? visibleProjects : visibleWorkspaces;
  const shownProjects = visibleProjects.slice(0, visibleLimit);
  const shownWorkspaces = visibleWorkspaces.slice(0, visibleLimit);
  const contextName = workspace?.name ?? "Workspaces";

  return (
    <aside className="context-sidebar panel-blur">
      <SidebarChrome
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onBack={onBack}
        onForward={onForward}
      />

      <div className="sidebar-context">
        {workspace ? (
          <button
            type="button"
            className="sidebar-context-button"
            title="Back to workspaces"
            onClick={onOpenLibrary}
          >
            <span className="sidebar-monogram">{initials(contextName)}</span>
            <span>{contextName}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        ) : (
          <div className="sidebar-context-button">
            <span className="sidebar-monogram">{initials(contextName)}</span>
            <span>{contextName}</span>
          </div>
        )}
        <button
          className={`icon-button${searchVisible ? " is-active" : ""}`}
          type="button"
          title={workspace ? "Filter projects" : "Filter workspaces"}
          aria-label={workspace ? "Filter projects" : "Filter workspaces"}
          aria-pressed={searchVisible}
          onClick={() => {
            setSearchVisible((visible) => !visible);
            if (searchVisible) setQuery("");
          }}
        >
          <Search size={16} strokeWidth={1.5} />
        </button>
      </div>

      {(searchVisible || query) && (
        <label className="sidebar-search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder={workspace ? "Filter projects" : "Filter workspaces"}
            aria-label={workspace ? "Filter projects" : "Filter workspaces"}
            onChange={(event) => {
              setQuery(event.target.value);
              setVisibleLimit(12);
            }}
          />
          <kbd>⌘F</kbd>
        </label>
      )}

      {workspace && (
        <div className="sidebar-nav">
          <button type="button" className="sidebar-nav-row" onClick={onOpenLibrary}>
            <Layers3 size={16} strokeWidth={1.5} />
            <span>All workspaces</span>
          </button>
          <div className="sidebar-nav-row">
            <UsersRound size={16} strokeWidth={1.5} />
            <span>Units</span>
            <small>{workspace.unitCount}</small>
          </div>
          <div className="sidebar-nav-row">
            <Boxes size={16} strokeWidth={1.5} />
            <span>Shared library</span>
            <small>{workspace.sharedCount}</small>
          </div>
        </div>
      )}

      <div className="sidebar-section-label">
        <span>{workspace ? "Projects" : "Recent workspaces"}</span>
        <span>{visibleItems.length}</span>
      </div>

      <div className="sidebar-list">
        {workspace
          ? shownProjects.map((project) => {
              const active =
                route.kind === "project" && route.projectId === project.projectId;
              const pinned = pinnedProjectIds.includes(project.id);
              return (
                <div
                  role="button"
                  tabIndex={0}
                  className={`sidebar-row${active ? " is-selected" : ""}`}
                  key={project.id}
                  onClick={() => onOpenProject(project)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenProject(project);
                    }
                  }}
                >
                  <Folder size={16} strokeWidth={1.5} aria-hidden="true" />
                  <span className="sidebar-row-copy">
                    <span className="sidebar-row-title">{project.name}</span>
                    <span className="sidebar-row-meta">
                      {project.phase ?? project.status}
                      <span aria-hidden="true">·</span>
                      {relativeActivity(project.recentActivity)}
                      {project.spendUsd !== null && (
                        <>
                          <span aria-hidden="true">·</span>
                          <CircleDollarSign size={11} aria-hidden="true" />
                          {project.spendUsd.toFixed(2)}
                        </>
                      )}
                    </span>
                  </span>
                  <PinButton
                    active={pinned}
                    label={pinned ? "Unpin project" : "Pin project"}
                    onClick={() => onToggleProjectPin(project.id)}
                  />
                </div>
              );
            })
          : shownWorkspaces.map((item) => {
              const pinned = pinnedWorkspaceIds.includes(item.id);
              return (
                <div
                  role="button"
                  tabIndex={0}
                  className="sidebar-row"
                  key={item.id}
                  onClick={() => onOpenWorkspace(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenWorkspace(item.id);
                    }
                  }}
                >
                  <FolderKanban size={16} strokeWidth={1.5} aria-hidden="true" />
                  <span className="sidebar-row-copy">
                    <span className="sidebar-row-title">{item.name}</span>
                    <span className="sidebar-row-meta">
                      {item.projectCount} projects
                      <span aria-hidden="true">·</span>
                      {relativeActivity(item.recentActivity)}
                    </span>
                  </span>
                  <PinButton
                    active={pinned}
                    label={pinned ? "Unpin workspace" : "Pin workspace"}
                    onClick={() => onToggleWorkspacePin(item.id)}
                  />
                </div>
              );
            })}
        {visibleItems.length === 0 && (
          <div className="sidebar-empty">No matching results</div>
        )}
        {visibleLimit < visibleItems.length && (
          <button
            className="sidebar-show-more"
            type="button"
            onClick={() => setVisibleLimit((limit) => limit + 24)}
          >
            Show more
          </button>
        )}
      </div>

      <div className="sidebar-footer">
        <span className="library-mark">R</span>
        <span title={rootPath}>{rootPath}</span>
        <button
          className="icon-button"
          type="button"
          title="Change .ralphy library"
          aria-label="Change .ralphy library"
          onClick={onChooseLibrary}
        >
          <FolderOpen size={15} strokeWidth={1.5} />
        </button>
      </div>
    </aside>
  );
}
