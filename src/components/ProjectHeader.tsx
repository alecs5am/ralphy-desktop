import {
  CircleDollarSign,
  Film,
  MonitorPlay,
  Radio,
} from "lucide-react";
import type { ProjectScanResult, ProjectSummary } from "../lib/ipc";

interface ProjectHeaderProps {
  project: ProjectSummary;
  scan: ProjectScanResult | null;
  loading: boolean;
}

function nextStep(project: ProjectSummary): string {
  if (project.finalCount > 0 && project.finalState === "ready") return "Ready for delivery";
  if (project.finalCount > 0) return "Review final render";
  if (project.phase === "production") return "Complete render";
  if (project.phase === "preflight") return "Approve production plan";
  return "Continue workflow";
}

export function ProjectHeader({ project, scan, loading }: ProjectHeaderProps) {
  const spend = scan?.ledger.totalCostUsd || project.spendUsd;
  return (
    <header className="project-header">
      <div className="project-heading">
        <div className="screen-kicker">Project · {project.projectId}</div>
        <h2>{project.name}</h2>
        <p>{project.brief || "Ralphy production project"}</p>
      </div>
      <div className="project-facts" aria-label="Production status">
        <span>
          <Radio size={13} />
          <i className={`phase-indicator phase-${project.phase ?? "unknown"}`} />
          {project.phase ?? project.status}
        </span>
        <span>
          <MonitorPlay size={13} />
          {[project.platform, project.aspectRatio].filter(Boolean).join(" · ") || "No format"}
        </span>
        <span>
          <Film size={13} />
          {project.finalState}
        </span>
        <span className="project-spend">
          <CircleDollarSign size={13} />
          {spend === null ? "Cost unknown" : `$${spend.toFixed(2)}`}
        </span>
      </div>
      <div className="next-step">
        <span>Next</span>
        <strong>{loading ? "Indexing project…" : nextStep(project)}</strong>
      </div>
    </header>
  );
}
