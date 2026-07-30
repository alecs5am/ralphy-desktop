import { Check, ChevronDown, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { WorkspaceSummary } from "../lib/ipc";

interface WorkspacePickerProps {
  value: string;
  workspaces: WorkspaceSummary[];
  onValueChange(workspaceId: string): void;
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

export function WorkspacePicker({
  value,
  workspaces,
  onValueChange,
}: WorkspacePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = workspaces.find((workspace) => workspace.id === value);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? workspaces.filter((workspace) =>
          `${workspace.name} ${workspace.description}`.toLocaleLowerCase().includes(needle))
      : workspaces;
  }, [query, workspaces]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    setActiveIndex((index) =>
      Math.min(Math.max(0, filtered.length - 1), Math.max(0, index)),
    );
  }, [filtered.length]);

  const closeAndRestoreFocus = () => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const select = (workspace: WorkspaceSummary) => {
    onValueChange(workspace.id);
    closeAndRestoreFocus();
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndRestoreFocus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) =>
        Math.min(Math.max(0, filtered.length - 1), index + 1),
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, filtered.length - 1));
    } else if (event.key === "Enter" && filtered[activeIndex]) {
      event.preventDefault();
      select(filtered[activeIndex]);
    }
  };

  return (
    <div className="workspace-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        className="workspace-picker-trigger"
        type="button"
        aria-label="Select workspace"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((visible) => !visible)}
      >
        <span className="workspace-option-avatar">
          {initials(selected?.name ?? "Workspace")}
        </span>
        <span className="workspace-picker-copy">
          <strong>{selected?.name ?? "Workspaces"}</strong>
          <small>{selected?.projectCount ?? 0} projects</small>
        </span>
        <ChevronDown
          className="workspace-picker-chevron"
          size={14}
          strokeWidth={1.6}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="workspace-picker-popover"
            initial={{ opacity: 0, scale: 0.98, y: -3 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -3 }}
            transition={{ duration: 0.14 }}
          >
            <label className="workspace-picker-search">
              <Search size={14} strokeWidth={1.5} />
              <input
                ref={inputRef}
                type="search"
                role="combobox"
                aria-label="Search workspaces"
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls={listId}
                aria-activedescendant={
                  filtered[activeIndex]
                    ? `${listId}-option-${activeIndex}`
                    : undefined
                }
                placeholder="Search workspaces"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={onSearchKeyDown}
              />
            </label>
            <div
              className="workspace-picker-list"
              id={listId}
              role="listbox"
              aria-label="Workspaces"
            >
              {filtered.map((workspace, index) => (
                <button
                  id={`${listId}-option-${index}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={workspace.id === value}
                  className={index === activeIndex ? "is-highlighted" : ""}
                  key={workspace.id}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => select(workspace)}
                >
                  <span className="workspace-option-avatar">
                    {initials(workspace.name)}
                  </span>
                  <span>
                    <strong>{workspace.name}</strong>
                    <small>{workspace.description || "Ralphy production workspace"}</small>
                  </span>
                  <em>{workspace.projectCount}</em>
                  {workspace.id === value && <Check size={13} strokeWidth={2} />}
                </button>
              ))}
              {filtered.length === 0 && (
                <span className="workspace-picker-empty">No workspaces found</span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
