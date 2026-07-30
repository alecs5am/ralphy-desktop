import {
  FileText,
  Film,
  GalleryHorizontalEnd,
  Image,
  Music2,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
import type {
  MediaGroup,
  MediaKind,
  MediaQueryOptions,
  ProjectMode,
  ReviewStatus,
} from "../lib/ipc";
import { resetProjectQuery } from "../lib/media";
import { SelectMenu } from "./ui/SelectMenu";

interface ProjectControlsProps {
  query: MediaQueryOptions;
  itemCount: number;
  kindCounts: Record<MediaKind, number>;
  gridSize: number;
  onChange(query: MediaQueryOptions): void;
  onGridSizeChange(size: number): void;
}

const modes: Array<{ value: ProjectMode; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "finals", label: "Finals" },
  { value: "assets", label: "Assets" },
  { value: "refs", label: "Refs" },
  { value: "units", label: "Units" },
  { value: "files", label: "Files" },
];

const kinds: Array<{ value: MediaKind; label: string; icon: React.ReactNode }> = [
  { value: "image", label: "Images", icon: <Image size={14} /> },
  { value: "video", label: "Video", icon: <Film size={14} /> },
  { value: "audio", label: "Audio", icon: <Music2 size={14} /> },
  { value: "text", label: "Text", icon: <FileText size={14} /> },
];

const reviews: Array<{ value: ReviewStatus; label: string; dot: string }> = [
  { value: "Shortlist", label: "Shortlist", dot: "accent" },
  { value: "Approved", label: "Approved", dot: "ok" },
  { value: "Needs Work", label: "Needs work", dot: "warn" },
  { value: "Reject", label: "Reject", dot: "danger" },
];

function toggleValue<Value>(values: Value[], value: Value): Value[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

export function ProjectControls({
  query,
  itemCount,
  kindCounts,
  gridSize,
  onChange,
  onGridSizeChange,
}: ProjectControlsProps) {
  const [filtersExpanded, setFiltersExpanded] = useState(true);
  const update = (values: Partial<MediaQueryOptions>) => onChange({ ...query, ...values });
  const activeFilterCount =
    query.kinds.length +
    query.reviewStatuses.length +
    (query.groupBy === "none" ? 0 : 1) +
    (query.sortBy === "recent" ? 0 : 1) +
    (query.includeIntermediate ? 1 : 0);
  const canReset =
    query.search.length > 0 ||
    query.kinds.length > 0 ||
    query.reviewStatuses.length > 0 ||
    query.groupBy !== "none" ||
    query.sortBy !== "recent";

  return (
    <div className="project-controls">
      <div className="project-toolbar">
        <div className="mode-segments" role="tablist" aria-label="Project view">
          {modes.map((mode) => (
            <button
              type="button"
              role="tab"
              aria-selected={query.mode === mode.value}
              className={query.mode === mode.value ? "is-active" : ""}
              key={mode.value}
              onClick={() => update({ mode: mode.value })}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {query.mode !== "overview" && (
          <>
            <label className="project-search">
              <Search size={15} strokeWidth={1.5} />
              <input
                type="search"
                aria-label="Search project files"
                placeholder="Search"
                value={query.search}
                onChange={(event) => update({ search: event.target.value })}
              />
            </label>
            <button
              className={`filters-button${activeFilterCount > 0 ? " is-active" : ""}${
                filtersExpanded ? " is-expanded" : ""
              }`}
              type="button"
              aria-expanded={filtersExpanded}
              onClick={() => setFiltersExpanded((expanded) => !expanded)}
            >
              <SlidersHorizontal size={15} strokeWidth={1.5} />
              Filters
              {activeFilterCount > 0 && (
                <span className="filter-count">{activeFilterCount}</span>
              )}
            </button>
            <div className="project-toolbar-tail">
              <span className="item-count">{itemCount.toLocaleString()} items</span>
              <label className="grid-size-control" title="Grid size">
                <GalleryHorizontalEnd size={15} strokeWidth={1.5} />
                <input
                  type="range"
                  min="150"
                  max="310"
                  step="20"
                  value={gridSize}
                  aria-label="Grid size"
                  onChange={(event) => onGridSizeChange(Number(event.target.value))}
                />
              </label>
            </div>
          </>
        )}
      </div>

      {query.mode !== "overview" && (
        <div
          className={`project-filter-chips${filtersExpanded ? " is-expanded" : ""}`}
          aria-label="Active project filters"
        >
          {kinds.map((kind) => {
            const active = query.kinds.includes(kind.value);
            return (
              <button
                type="button"
                aria-pressed={active}
                className={`filter-chip${active ? " is-active" : ""}`}
                key={kind.value}
                onClick={() => update({ kinds: toggleValue(query.kinds, kind.value) })}
              >
                {kind.icon}
                {kind.label}
                <small>{kindCounts[kind.value]}</small>
              </button>
            );
          })}
          {reviews.map((review) => {
            const active = query.reviewStatuses.includes(review.value);
            return (
              <button
                type="button"
                aria-pressed={active}
                className={`filter-chip${active ? " is-active" : ""}`}
                key={review.value}
                onClick={() =>
                  update({
                    reviewStatuses: toggleValue(query.reviewStatuses, review.value),
                  })
                }
              >
                <span className={`status-dot dot-${review.dot}`} />
                {review.label}
              </button>
            );
          })}
          <SelectMenu<MediaGroup>
            value={query.groupBy}
            ariaLabel="Group files"
            className="filter-select-chip"
            prefix="Group ·"
            options={[
              { value: "none", label: "None" },
              { value: "entity", label: "Ralphy" },
              { value: "kind", label: "Type" },
              { value: "review", label: "Review" },
            ]}
            onValueChange={(groupBy) => update({ groupBy })}
          />
          <SelectMenu<MediaQueryOptions["sortBy"]>
            value={query.sortBy}
            ariaLabel="Sort files"
            className="filter-select-chip"
            prefix="Sort ·"
            options={[
              { value: "recent", label: "Recent" },
              { value: "name", label: "Name" },
              { value: "size", label: "Size" },
              { value: "cost", label: "Cost" },
              { value: "review", label: "Review" },
            ]}
            onValueChange={(sortBy) => update({ sortBy })}
          />
          <label
            className={`filter-chip check-chip${query.includeIntermediate ? " is-active" : ""}`}
          >
            <input
              type="checkbox"
              checked={query.includeIntermediate}
              onChange={(event) => update({ includeIntermediate: event.target.checked })}
            />
            Intermediates
          </label>
          <button
            className="reset-filters"
            type="button"
            disabled={!canReset}
            onClick={() => onChange(resetProjectQuery(query))}
          >
            <RotateCcw size={13} strokeWidth={1.5} />
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
