import {
  CircleDollarSign,
  FolderKanban,
  PanelBottomClose,
  PanelRightClose,
  TerminalSquare,
} from "lucide-react";
import { motion } from "motion/react";
import type { ProjectSummary, WorkspaceSummary } from "../lib/ipc";

export function RightPanelSummary({
  workspace,
  project,
  onClose,
}: {
  workspace: WorkspaceSummary | null;
  project: ProjectSummary | null;
  onClose(): void;
}) {
  return (
    <motion.aside
      className="utility-right-panel panel-blur"
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.2, 0, 0.2, 1] }}
    >
      <header className="utility-panel-header">
        <span>Details</span>
        <button
          className="icon-button"
          type="button"
          title="Close right panel"
          aria-label="Close right panel"
          onClick={onClose}
        >
          <PanelRightClose size={15} strokeWidth={1.5} />
        </button>
      </header>
      <div className="utility-panel-body">
        <div className="utility-identity">
          <span className="utility-identity-icon">
            <FolderKanban size={16} strokeWidth={1.5} />
          </span>
          <span>
            <strong>{project?.name ?? workspace?.name ?? "Ralphy Media"}</strong>
            <small>{project ? "Project" : workspace ? "Workspace" : "Library"}</small>
          </span>
        </div>
        {workspace && (
          <section className="utility-properties">
            <div>
              <span>Projects</span>
              <strong>{workspace.projectCount}</strong>
            </div>
            <div>
              <span>Final renders</span>
              <strong>{workspace.finalCount}</strong>
            </div>
            <div>
              <span>Units</span>
              <strong>{workspace.unitCount}</strong>
            </div>
          </section>
        )}
        {project && (
          <section className="utility-properties">
            <div>
              <span>Phase</span>
              <strong>{project.phase ?? project.status}</strong>
            </div>
            <div>
              <span>Final</span>
              <strong>{project.finalState}</strong>
            </div>
            <div>
              <span><CircleDollarSign size={12} /> Spend</span>
              <strong>
                {project.spendUsd === null ? "Unknown" : `$${project.spendUsd.toFixed(2)}`}
              </strong>
            </div>
          </section>
        )}
      </div>
    </motion.aside>
  );
}

export function BottomPanel({ onClose }: { onClose(): void }) {
  return (
    <motion.section
      className="bottom-panel"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 220, opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: [0.2, 0, 0.2, 1] }}
    >
      <header className="bottom-panel-header">
        <button className="bottom-panel-tab is-active" type="button">
          <TerminalSquare size={14} strokeWidth={1.5} />
          Terminal
        </button>
        <span className="bottom-panel-status">Idle</span>
        <button
          className="icon-button"
          type="button"
          title="Close bottom panel"
          aria-label="Close bottom panel"
          onClick={onClose}
        >
          <PanelBottomClose size={15} strokeWidth={1.5} />
        </button>
      </header>
      <div className="terminal-surface" aria-label="Terminal">
        <span className="terminal-prompt">~</span>
        <span className="terminal-caret" aria-hidden="true" />
      </div>
    </motion.section>
  );
}
