import { Clipboard } from "lucide-react";
import type { ProjectScanResult, ProjectSummary } from "../lib/ipc";

interface ProjectHeaderProps {
  project: ProjectSummary;
  scan: ProjectScanResult | null;
  loading: boolean;
  copyState: "idle" | "copied" | "failed";
  onCopyForAgent(): void;
}

function nextStep(project: ProjectSummary): string {
  if (project.finalCount > 0 && project.finalState === "ready") return "Ready for delivery";
  if (project.finalCount > 0) return "Review final render";
  if (project.phase === "production") return "Complete render";
  if (project.phase === "preflight") return "Approve production plan";
  return "Continue workflow";
}

export function ProjectHeader({
  project,
  scan,
  loading,
  copyState,
  onCopyForAgent,
}: ProjectHeaderProps) {
  const spend = scan?.ledger.totalCostUsd ?? project.spendUsd;
  return (
    <header className="project-header">
      <div className="project-header-top">
        <div className="project-heading">
          <h2>{project.name}</h2>
          <p>{project.brief || "Ralphy production project"}</p>
        </div>
        <button
          className={`command-button${copyState === "failed" ? " is-error" : ""}`}
          type="button"
          onClick={onCopyForAgent}
        >
          <Clipboard size={15} strokeWidth={1.5} />
          {copyState === "copied"
            ? "Copied"
            : copyState === "failed"
              ? "Copy failed"
              : "Copy for Agent"}
        </button>
      </div>
      <div className="project-facts" aria-label="Production status">
        <span>
          <i className={`phase-indicator phase-${project.phase ?? "unknown"}`} />
          {project.phase ?? project.status}
        </span>
        <span>
          {[project.platform, project.aspectRatio].filter(Boolean).join(" · ") || "No format"}
        </span>
        <span>{project.finalState}</span>
        <span className="project-spend">
          {spend === null ? "Cost unknown" : `$${spend.toFixed(2)}`}
        </span>
        <span className="next-step">
          Next · {loading ? "Indexing project…" : nextStep(project)}
        </span>
      </div>
    </header>
  );
}
