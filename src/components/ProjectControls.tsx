import {
  Boxes,
  FileText,
  Film,
  GalleryHorizontalEnd,
  Image,
  LayoutDashboard,
  Music2,
  Search,
  UsersRound,
} from "lucide-react";
import type {
  MediaGroup,
  MediaKind,
  MediaQueryOptions,
  ProjectMode,
  ReviewStatus,
} from "../lib/ipc";

interface ProjectControlsProps {
  query: MediaQueryOptions;
  itemCount: number;
  gridSize: number;
  onChange(query: MediaQueryOptions): void;
  onGridSizeChange(size: number): void;
}

const modes: Array<{
  value: ProjectMode;
  label: string;
  icon: React.ReactNode;
}> = [
  { value: "overview", label: "Overview", icon: <LayoutDashboard size={13} /> },
  { value: "finals", label: "Finals", icon: <Film size={13} /> },
  { value: "assets", label: "Assets", icon: <Boxes size={13} /> },
  { value: "refs", label: "Refs", icon: <Image size={13} /> },
  { value: "units", label: "Units", icon: <UsersRound size={13} /> },
  { value: "files", label: "Files", icon: <FileText size={13} /> },
];

const kinds: Array<{ value: MediaKind; label: string; icon: React.ReactNode }> = [
  { value: "image", label: "Images", icon: <Image size={12} /> },
  { value: "video", label: "Video", icon: <Film size={12} /> },
  { value: "audio", label: "Audio", icon: <Music2 size={12} /> },
  { value: "text", label: "Text", icon: <FileText size={12} /> },
];

const reviews: Array<{ value: ReviewStatus; label: string }> = [
  { value: "Shortlist", label: "Shortlist" },
  { value: "Approved", label: "Approved" },
  { value: "Needs Work", label: "Needs work" },
  { value: "Reject", label: "Reject" },
];

function toggleValue<Value>(
  values: Value[],
  value: Value,
): Value[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

export function ProjectControls({
  query,
  itemCount,
  gridSize,
  onChange,
  onGridSizeChange,
}: ProjectControlsProps) {
  const update = (values: Partial<MediaQueryOptions>) => onChange({ ...query, ...values });
  return (
    <div className="project-controls">
      <div className="mode-bar" role="tablist" aria-label="Project view">
        {modes.map((mode) => (
          <button
            type="button"
            role="tab"
            aria-selected={query.mode === mode.value}
            className={query.mode === mode.value ? "is-active" : ""}
            key={mode.value}
            onClick={() => update({ mode: mode.value })}
          >
            {mode.icon}
            {mode.label}
          </button>
        ))}
        <span className="mode-count">{itemCount.toLocaleString()} items</span>
      </div>

      {query.mode !== "overview" && (
        <div className="filter-bar">
          <label className="project-search">
            <Search size={13} />
            <input
              type="search"
              aria-label="Search project files"
              placeholder="Search this project"
              value={query.search}
              onChange={(event) => update({ search: event.target.value })}
            />
          </label>
          <div className="control-group" aria-label="Media type">
            <span>Type</span>
            {kinds.map((kind) => (
              <button
                type="button"
                title={kind.label}
                aria-label={kind.label}
                aria-pressed={query.kinds.includes(kind.value)}
                className={query.kinds.includes(kind.value) ? "is-active" : ""}
                key={kind.value}
                onClick={() => update({ kinds: toggleValue(query.kinds, kind.value) })}
              >
                {kind.icon}
              </button>
            ))}
          </div>
          <div className="control-group review-filter" aria-label="Review status">
            <span>Review</span>
            {reviews.map((review) => (
              <button
                type="button"
                aria-pressed={query.reviewStatuses.includes(review.value)}
                className={query.reviewStatuses.includes(review.value) ? "is-active" : ""}
                key={review.value}
                onClick={() =>
                  update({
                    reviewStatuses: toggleValue(query.reviewStatuses, review.value),
                  })
                }
              >
                {review.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {query.mode !== "overview" && (
        <div className="arrange-bar">
          <div className="control-group group-control" aria-label="Group files">
            <span>Group</span>
            {([
              ["none", "None"],
              ["entity", "Ralphy"],
              ["kind", "Type"],
              ["review", "Review"],
            ] as Array<[MediaGroup, string]>).map(([value, label]) => (
              <button
                type="button"
                aria-pressed={query.groupBy === value}
                className={query.groupBy === value ? "is-active" : ""}
                key={value}
                onClick={() => update({ groupBy: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="select-control">
            <span>Sort</span>
            <select
              value={query.sortBy}
              onChange={(event) =>
                update({ sortBy: event.target.value as MediaQueryOptions["sortBy"] })
              }
            >
              <option value="recent">Recent</option>
              <option value="name">Name</option>
              <option value="size">Size</option>
              <option value="cost">Cost</option>
              <option value="review">Review</option>
            </select>
          </label>
          <label className="check-control">
            <input
              type="checkbox"
              checked={query.includeIntermediate}
              onChange={(event) => update({ includeIntermediate: event.target.checked })}
            />
            Intermediates
          </label>
          <label className="grid-size-control" title="Grid size">
            <GalleryHorizontalEnd size={13} />
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
      )}
    </div>
  );
}
