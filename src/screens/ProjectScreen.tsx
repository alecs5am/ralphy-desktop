import {
  ArrowRight,
  Boxes,
  FileText,
  Film,
  Image,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ProjectControls } from "../components/ProjectControls";
import { ProjectHeader } from "../components/ProjectHeader";
import { VirtualAssetGrid } from "../components/VirtualAssetGrid";
import type {
  MediaAnnotation,
  MediaItem,
  MediaQueryOptions,
  ProjectMode,
  ProjectScanResult,
  ProjectSummary,
} from "../lib/ipc";
import {
  defaultMediaQuery,
  groupMediaItems,
  queryMediaItems,
} from "../lib/media";

interface ProjectScreenProps {
  project: ProjectSummary;
  scan: ProjectScanResult | null;
  annotations: Record<string, MediaAnnotation>;
  loading: boolean;
  includeIntermediate: boolean;
  onIncludeIntermediateChange(value: boolean): void;
  onOpenAsset(item: MediaItem, visibleItems: MediaItem[]): void;
  onSelectAsset(item: MediaItem | null): void;
}

const overviewSections: Array<{
  mode: ProjectMode;
  label: string;
  entity: MediaItem["entity"];
  icon: React.ReactNode;
}> = [
  { mode: "finals", label: "Final renders", entity: "final-render", icon: <Film size={16} /> },
  { mode: "assets", label: "Generated artifacts", entity: "generated-artifact", icon: <Boxes size={16} /> },
  { mode: "refs", label: "References", entity: "reference", icon: <Image size={16} /> },
  { mode: "units", label: "Unit assets", entity: "unit-asset", icon: <UsersRound size={16} /> },
  { mode: "files", label: "Production files", entity: "lifecycle-document", icon: <FileText size={16} /> },
];

export function ProjectScreen({
  project,
  scan,
  annotations,
  loading,
  includeIntermediate,
  onIncludeIntermediateChange,
  onOpenAsset,
  onSelectAsset,
}: ProjectScreenProps) {
  const [query, setQuery] = useState<MediaQueryOptions>({
    ...defaultMediaQuery,
    includeIntermediate,
  });
  const [gridSize, setGridSize] = useState(230);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const items = scan?.items ?? [];

  useEffect(() => {
    setQuery({ ...defaultMediaQuery, includeIntermediate });
    setSelectedId(null);
  }, [project.projectId]);

  const visibleItems = useMemo(
    () => queryMediaItems(items, query, annotations),
    [annotations, items, query],
  );
  const groups = useMemo(
    () => groupMediaItems(visibleItems, query.groupBy, annotations),
    [annotations, query.groupBy, visibleItems],
  );

  const updateQuery = (next: MediaQueryOptions) => {
    if (next.includeIntermediate !== query.includeIntermediate) {
      onIncludeIntermediateChange(next.includeIntermediate);
    }
    setQuery(next);
    setSelectedId(null);
    onSelectAsset(null);
  };

  const selectAsset = (item: MediaItem) => {
    setSelectedId(item.id);
    onSelectAsset(item);
  };

  return (
    <main className="main-region project-region">
      <ProjectHeader project={project} scan={scan} loading={loading} />
      <ProjectControls
        query={query}
        itemCount={query.mode === "overview" ? items.length : visibleItems.length}
        gridSize={gridSize}
        onChange={updateQuery}
        onGridSizeChange={setGridSize}
      />

      {query.mode === "overview" ? (
        <div className="project-overview">
          <section className="production-structure">
            <div className="section-heading">
              <h3>Production structure</h3>
              <span>Ralphy entities</span>
            </div>
            {overviewSections.map((section) => {
              const count =
                section.mode === "files"
                  ? items.filter((item) =>
                      ["lifecycle-document", "production-file", "other-project-file"].includes(item.entity),
                    ).length
                  : items.filter((item) => item.entity === section.entity).length;
              return (
                <button
                  className="structure-row"
                  type="button"
                  key={section.mode}
                  onClick={() => updateQuery({ ...query, mode: section.mode })}
                >
                  <span className="structure-icon">{section.icon}</span>
                  <span><strong>{section.label}</strong><small>{count} items</small></span>
                  <ArrowRight size={14} />
                </button>
              );
            })}
          </section>
          <section className="generation-ledger">
            <div className="section-heading">
              <h3>Generation ledger</h3>
              <span>{scan?.ledger.entries.length ?? 0} operations</span>
            </div>
            {(scan?.ledger.entries ?? []).slice(0, 8).map((entry, index) => (
              <div className="ledger-row" key={`${entry.timestamp}-${entry.operation}-${index}`}>
                <span className="status-dot" />
                <span>
                  <strong>{entry.operation}</strong>
                  <small>{entry.provider} · {entry.model}</small>
                </span>
                <span>{entry.costUsd === null ? "—" : `$${entry.costUsd.toFixed(2)}`}</span>
              </div>
            ))}
            {!loading && (scan?.ledger.entries.length ?? 0) === 0 && (
              <div className="empty-section">No attributed generations in this project.</div>
            )}
          </section>
        </div>
      ) : loading && !scan ? (
        <div className="project-indexing">
          <span className="loading-line" />
          <span>Indexing selected project…</span>
        </div>
      ) : (
        <VirtualAssetGrid
          groups={groups}
          annotations={annotations}
          targetTileWidth={gridSize}
          selectedId={selectedId}
          onSelect={selectAsset}
          onOpen={(item) => onOpenAsset(item, visibleItems)}
        />
      )}
    </main>
  );
}
