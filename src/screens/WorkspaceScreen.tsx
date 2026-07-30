import {
  ArrowRight,
  Boxes,
  CircleDollarSign,
  Film,
  FolderOpen,
  UsersRound,
} from "lucide-react";
import type { ProjectSummary, WorkspaceSummary } from "../lib/ipc";
import { sortProjects } from "../state/workbench";

interface WorkspaceScreenProps {
  workspace: WorkspaceSummary;
  projects: ProjectSummary[];
  pinnedProjectIds: string[];
  onOpenProject(project: ProjectSummary): void;
}

export function WorkspaceScreen({
  workspace,
  projects,
  pinnedProjectIds,
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
        <span className="activity-stamp">
          Updated {new Date(workspace.recentActivity).toLocaleDateString()}
        </span>
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

      <section className="workspace-shortcuts" aria-label="Workspace media">
        <div className="shortcut-row">
          <UsersRound size={16} />
          <span><strong>Units</strong><small>{workspace.unitCount} reusable assets</small></span>
        </div>
        <div className="shortcut-row">
          <Boxes size={16} />
          <span><strong>Shared library</strong><small>{workspace.sharedCount} references</small></span>
        </div>
      </section>

      <section className="content-section workspace-projects">
        <div className="section-heading">
          <h3>Recent projects</h3>
          <span>Sorted by activity</span>
        </div>
        <div className="project-table" role="table" aria-label="Projects">
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
          {ordered.length === 0 && <div className="empty-section">No projects in this workspace.</div>}
        </div>
      </section>
    </main>
  );
}
