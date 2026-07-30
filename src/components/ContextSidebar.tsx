import {
  ArrowLeft,
  CircleDollarSign,
  Folder,
  FolderKanban,
  Pin,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  ProjectSummary,
  WorkspaceSummary,
} from "../lib/ipc";
import {
  sortProjects,
  sortWorkspaces,
  type WorkbenchRoute,
} from "../state/workbench";

interface ContextSidebarProps {
  route: WorkbenchRoute;
  workspaces: WorkspaceSummary[];
  projects: ProjectSummary[];
  pinnedWorkspaceIds: string[];
  pinnedProjectIds: string[];
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
      <Pin size={12} fill={active ? "currentColor" : "none"} />
    </button>
  );
}

export function ContextSidebar({
  route,
  workspaces,
  projects,
  pinnedWorkspaceIds,
  pinnedProjectIds,
  onOpenLibrary,
  onOpenWorkspace,
  onOpenProject,
  onToggleWorkspacePin,
  onToggleProjectPin,
}: ContextSidebarProps) {
  const [query, setQuery] = useState("");
  const workspaceId = route.kind === "library" ? null : route.workspaceId;
  const workspace = workspaces.find((item) => item.id === workspaceId);
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

  return (
    <aside className="context-sidebar">
      <div className="sidebar-heading">
        {workspace ? (
          <button
            type="button"
            className="sidebar-context-back"
            onClick={onOpenLibrary}
          >
            <ArrowLeft size={14} />
            <span>Workspaces</span>
          </button>
        ) : (
          <div>
            <div className="sidebar-kicker">Ralphy library</div>
            <h1>Workspaces</h1>
          </div>
        )}
        {workspace && (
          <div className="sidebar-workspace-title">
            <FolderKanban size={15} aria-hidden="true" />
            <h1>{workspace.name}</h1>
          </div>
        )}
      </div>

      <label className="sidebar-search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder={workspace ? "Filter projects" : "Filter workspaces"}
          aria-label={workspace ? "Filter projects" : "Filter workspaces"}
          onChange={(event) => setQuery(event.target.value)}
        />
        <kbd>⌘F</kbd>
      </label>

      <div className="sidebar-section-label">
        <span>{workspace ? "Projects" : "Recent"}</span>
        <span>{workspace ? visibleProjects.length : visibleWorkspaces.length}</span>
      </div>

      <div className="sidebar-list">
        {workspace
          ? visibleProjects.map((project) => {
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
                  <Folder size={15} strokeWidth={1.7} aria-hidden="true" />
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
          : visibleWorkspaces.map((item) => {
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
                  <FolderKanban size={15} strokeWidth={1.7} aria-hidden="true" />
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
        {(workspace ? visibleProjects : visibleWorkspaces).length === 0 && (
          <div className="sidebar-empty">No matching results</div>
        )}
      </div>
    </aside>
  );
}
