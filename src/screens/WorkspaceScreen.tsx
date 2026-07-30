import {
  ArrowRight,
  Boxes,
  CircleDollarSign,
  Film,
  FolderOpen,
  LayoutGrid,
  List,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ProjectSummary, WorkspaceSummary } from "../lib/ipc";
import { sortProjects, type WorkspaceView } from "../state/workbench";

interface WorkspaceScreenProps {
  workspace: WorkspaceSummary;
  projects: ProjectSummary[];
  pinnedProjectIds: string[];
  view: WorkspaceView;
  onViewChange(view: WorkspaceView): void;
  onOpenProject(project: ProjectSummary): void;
}

function relativeActivity(value: string): string {
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed) || elapsed < 0) return "now";
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 24) return `${Math.max(1, hours)}h`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d` : new Date(value).toLocaleDateString();
}

export function WorkspaceScreen({
  workspace,
  projects,
  pinnedProjectIds,
  view,
  onViewChange,
  onOpenProject,
}: WorkspaceScreenProps) {
  const ordered = sortProjects(projects, pinnedProjectIds);
  const projectsWithSpend = projects.filter((project) => project.spendUsd !== null);
  const spend = projectsWithSpend.reduce(
    (total, project) => total + (project.spendUsd ?? 0),
    0,
  );
  const finals = projects.reduce((total, project) => total + project.finalCount, 0);
  const active = projects.filter((project) => project.status !== "done").length;

  return (
    <main className="main-region">
      <div className="screen-header workspace-header">
        <div>
          <div className="screen-kicker">Workspace</div>
          <h2>{workspace.name}</h2>
          <p>{workspace.description || "Ralphy production workspace"}</p>
        </div>
        <div className="workspace-header-actions">
          <span className="activity-stamp">
            Updated {new Date(workspace.recentActivity).toLocaleDateString()}
          </span>
          <div className="view-segments" role="group" aria-label="Project view">
            <button
              className={view === "grid" ? "is-active" : ""}
              type="button"
              title="Grid view"
              aria-label="Grid view"
              aria-pressed={view === "grid"}
              onClick={() => onViewChange("grid")}
            >
              <LayoutGrid size={15} strokeWidth={1.5} />
            </button>
            <button
              className={view === "list" ? "is-active" : ""}
              type="button"
              title="List view"
              aria-label="List view"
              aria-pressed={view === "list"}
              onClick={() => onViewChange("list")}
            >
              <List size={15} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>

      <section className="metrics-band" aria-label="Workspace summary">
        <div className="metric">
          <span className="metric-icon"><FolderOpen size={15} /></span>
          <span className="metric-value">{projects.length}</span>
          <span className="metric-label">Projects</span>
        </div>
        <div className="metric">
          <span className="metric-icon"><Film size={15} /></span>
          <span className="metric-value">{finals}</span>
          <span className="metric-label">Final renders</span>
        </div>
        <div className="metric">
          <span className="metric-icon"><Boxes size={15} /></span>
          <span className="metric-value">{active}</span>
          <span className="metric-label">In production</span>
        </div>
        <div className="metric">
          <span className="metric-icon"><CircleDollarSign size={15} /></span>
          <span className="metric-value">
            {projectsWithSpend.length === 0 ? "—" : `$${spend.toFixed(2)}`}
          </span>
          <span className="metric-label">Indexed project spend</span>
        </div>
      </section>

      <section className="content-section workspace-projects">
        <div className="section-heading">
          <h3>Recent projects</h3>
          <span>Sorted by activity</span>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          {view === "grid" ? (
            <motion.div
              className="workspace-project-grid"
              key="grid"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
            >
              {ordered.map((project) => (
                <motion.button
                  className="workspace-project-card"
                  type="button"
                  layout="position"
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.99 }}
                  key={project.id}
                  onClick={() => onOpenProject(project)}
                >
                  <span className="workspace-project-card-head">
                    <span className="workspace-project-icon">
                      <FolderOpen size={16} strokeWidth={1.5} />
                    </span>
                    <span className="workspace-project-phase">
                      <i className={`phase-indicator phase-${project.phase ?? "unknown"}`} />
                      {project.phase ?? project.status}
                    </span>
                  </span>
                  <span className="workspace-project-card-copy">
                    <strong>{project.name}</strong>
                    <small>{project.brief || project.projectId}</small>
                  </span>
                  <span className="workspace-project-card-footer">
                    <span>{project.finalState}</span>
                    <span className="mono-number">
                      {project.spendUsd === null ? "—" : `$${project.spendUsd.toFixed(2)}`}
                    </span>
                    <span>{relativeActivity(project.recentActivity)}</span>
                    <ArrowRight size={14} />
                  </span>
                </motion.button>
              ))}
            </motion.div>
          ) : (
            <motion.div
              className="project-table"
              role="table"
              aria-label="Projects"
              key="list"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
            >
              <div className="project-table-head" role="row">
                <span>Name</span>
                <span>Phase</span>
                <span>Final</span>
                <span>Spend</span>
                <span />
              </div>
              {ordered.map((project) => (
                <button
                  className="project-table-row"
                  type="button"
                  role="row"
                  key={project.id}
                  onClick={() => onOpenProject(project)}
                >
                  <span className="project-name-cell">
                    <strong>{project.name}</strong>
                    <small>{project.brief || project.projectId}</small>
                  </span>
                  <span><i className={`phase-indicator phase-${project.phase ?? "unknown"}`} />{project.phase ?? project.status}</span>
                  <span>{project.finalState}</span>
                  <span className="mono-number">
                    {project.spendUsd === null ? "—" : `$${project.spendUsd.toFixed(2)}`}
                  </span>
                  <ArrowRight size={14} />
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        {ordered.length === 0 && (
          <div className="empty-section">No projects in this workspace.</div>
        )}
      </section>
    </main>
  );
}
