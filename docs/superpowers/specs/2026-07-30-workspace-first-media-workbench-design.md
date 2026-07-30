# Workspace-First Media Workbench Redesign

## Context

The native Ralphy Media MVP proves the core file-review workflow, but its
library-first architecture eagerly represents every supported file under the
selected `.ralphy` tree. The real repository currently contains dozens of
workspaces, more than one hundred projects, and more than 17,000 relevant
assets. Showing or filtering that global collection is both slow and poorly
matched to how Ralphy work is organized.

The redesign turns the app from a generic file library into a native Ralphy
workbench. A workspace is always the primary context, projects are entered from
that workspace, and media is presented according to Ralphy's production model.

## Product Decisions

- The app remains a native SwiftUI/AppKit macOS application.
- The app opens a user-selected `.ralphy` directory and never depends on
  `.ralphy/config.json.activeWorkspace`.
- The user's last selected workspace and project are app-local preferences.
- Startup never opens a global asset collection.
- The default project experience is a project overview, not an unfiltered file
  grid.
- The app reads existing Ralphy contracts but does not require changes to the
  Ralphy CLI or import source from sibling repositories.
- Review annotations remain local to the selected `.ralphy` library.
- Destructive deletion means moving an item to the macOS Trash.

## Navigation Model

The application has one contextual sidebar and one main content area. It does
not show separate workspace and project columns at the same time.

The route hierarchy is:

`Library -> Workspace -> Project -> Asset`

### Library Level

The sidebar lists workspaces, sorted by derived recent activity by default. It
also provides search, pinning, and explicit alternative sorting by name or
project count. The main area is a lightweight Ralphy overview containing recent
workspace activity and aggregate counts, never an all-assets grid.

Selecting a workspace pushes the navigation route and replaces the sidebar
contents with that workspace's projects.

### Workspace Level

The sidebar header contains a back button, workspace name, project search, and
the current sort control. The rows below list projects with status, last
activity, current lifecycle phase, final-render state, and spend when known.
Projects are sorted by derived activity by default and may be pinned.

Before a project is selected, the main area shows the workspace dashboard:

- active and recently changed projects
- final renders awaiting review
- current aggregate generation spend
- recent unit activity
- project status and lifecycle distribution
- shortcuts to shared assets and workspace-level units

The dashboard uses summaries and bounded recent records. It does not recursively
index every project.

### Project Level

Selecting a project keeps the project list in the sidebar and changes the main
area to that project. The project header shows its brief, platform, aspect
ratio, lifecycle phase, next expected step, last activity, spend, and output
status.

The main project modes are always visible:

- `Overview`: lifecycle, recent generations, key documents, spend, and next step
- `Finals`: files under `render/` intended as finished output
- `Assets`: generated images, video, audio, captions, and other artifacts
- `Refs`: source and reference media under `artifacts/refs`
- `Units`: project deliverables under `units`
- `Files`: production documents, scripts, compositions, logs, and uncategorized
  project files

The selected mode, filters, grouping, and sort order are visible above the
content. They are not hidden behind icon-only menus.

### Back Navigation

Toolbar Back, `Command-[`, and the mouse back button pop the same route stack.
Returning from an asset restores the exact project mode, selection, filter
state, and grid scroll anchor. Returning from a project shows the workspace
dashboard. Returning from a workspace shows the workspace list.

## Ralphy Domain Mapping

The app classifies files by path and project metadata:

- `render/` is a final or intermediate render, with `render/final.*` promoted
  as the canonical final
- `artifacts/refs/` is reference or input media
- other `artifacts/<kind>/` directories are generated assets
- project and workspace `units/` directories are reusable deliverables
- `BRIEF.md`, production plans, style documents, evaluations, and postmortems
  are lifecycle documents
- scripts, compositions, HTML, and logs are production files

The lifecycle model recognizes Ralphy's production phases and derives the
current phase from available project records when an explicit phase is absent.
Legacy and unregistered projects remain navigable.

Project activity is derived in this order:

1. latest successful or failed generation timestamp
2. latest significant render, artifact, unit, or lifecycle-document change
3. registry `updatedAt`
4. registry `createdAt`
5. project directory modification time

Generation records from `logs/generations.jsonl` provide project spend and,
when possible, per-file cost. A generation maps to an asset first by normalized
`output.local`, then by manifest slot and output metadata. Ambiguous costs stay
at project level rather than being assigned to the wrong file.

## Data and Performance Architecture

The app uses three bounded layers instead of one global media index.

### Workspace Catalog

`WorkspaceCatalog` performs a shallow scan of `workspaces/*` and project
directories. It reads registry records, workspace manifests, project metadata,
significant timestamps, final-render presence, and generation summaries. It
does not enumerate project media trees or create `MediaItem` values.

The catalog is loaded off the main actor and published as one immutable
snapshot. A stale load cannot replace a newer one.

### Project Session

Only the selected project owns an active `ProjectSession`. It scans supported
files for that project, parses its manifests and generation ledger, and builds
the entity sections used by the project modes. Switching projects cancels the
old session and immediately clears heavyweight preview state.

At most one foreground project scan and one coalesced follow-up scan may run.
The project grid filters and sorts only that project's records.

### Filesystem Synchronization

One FSEvents stream watches the selected `.ralphy/workspaces` root. Event paths
are routed to the affected workspace and project:

- metadata changes refresh the corresponding summary
- selected-project changes refresh its active session
- changes in an inactive project invalidate only its summary
- workspace/project creation or removal refreshes the shallow catalog

Bursts are debounced and coalesced. A newly completed generation should appear
in the selected project within one second without rescanning unrelated
projects. Files still being written are represented as pending and previewed
only after their size and modification time stabilize.

### Preview Pipeline

Grid cells never decode media synchronously. Visible cells request thumbnails
through a bounded actor-backed pipeline with:

- stable cache keys based on path, size, modification time, and target pixels
- cancellation when a cell leaves the viewport
- a small concurrent-generation limit
- cost-limited decoded-image memory caching
- native Quick Look thumbnail generation and system caches

One reusable AV player backs the immersive video or audio viewer. Project
switches and route changes cancel obsolete Markdown, PDF, AV, and image loads.
Lightweight metadata updates before heavyweight preview content.

### Performance Budgets

Validation on the user's real library must demonstrate:

- no recursive asset enumeration before a project is selected
- an interactive window within one second of cold launch
- workspace/project row selection feedback within 100 ms
- indexing a representative 150-file project within 300 ms, excluding
  asynchronous thumbnail generation
- selected-project filesystem updates visible within one second
- no synchronous file decoding or ledger parsing on the main actor
- stable memory after repeatedly switching among ten representative projects
- smooth grid scrolling while thumbnails are still being generated

Benchmarks report actual timings and memory rather than silently relaxing these
budgets.

## Review and Viewer Workflow

Double-clicking a file replaces the project content with an in-place viewer. It
never opens a second application window. The viewer supports previous/next
navigation, video and audio playback, image zoom, PDF pages, rendered Markdown,
and raw text.

Markdown opens in rendered mode with a visible `Rendered / Source` control.
Parsing failure falls back to source without blocking navigation.

Review state supports:

- `Unreviewed`
- `Shortlist`
- `Approved`
- `Needs Work`
- `Reject`
- zero-to-five rating
- favorite
- normalized user tags
- free-form note

Existing `keep`, `maybe`, and `reject` annotations migrate without data loss.
Status, rating, favorite, and common tags are keyboard-accessible and support
batch selection. Reject marks an item unusable but does not delete it.

`Copy for Agent` creates a concise Markdown block containing workspace,
project, Ralphy entity type, relative and absolute paths, generation cost when
known, review status, rating, tags, and the user's note. Multi-selection creates
one grouped block suitable for Codex, Claude Code, or another local agent.

## Visual Language

The interface adopts the calm density and hierarchy of Codex Desktop without
copying or depending on its application resources:

- one compact contextual sidebar
- edge-to-edge work surfaces instead of floating section cards
- restrained separators and low-contrast grouped rows
- compact controls with SF Symbols and clear hover/selected states
- system UI typography and monospaced metadata treatment
- integrated macOS title bar, familiar focus behavior, and keyboard navigation
- radii no larger than 8 points for framed controls and repeated items

Ralphy identity is carried by color and small brand moments:

- near-black and neutral graphite surfaces
- warm off-white primary text
- dusty rose as the primary selection and focus accent
- amber for lifecycle progress, spend, and attention states
- semantic green and red reserved for approved and rejected outcomes
- a simplified Ralphy mascot mark for the app icon and empty states

The palette must work in dark and light appearances, but dark is the primary
art direction. The screen should feel like a focused production tool, not a
default SwiftUI sample or a marketing page.

## Persistence and Compatibility

The security-scoped bookmark for the chosen `.ralphy` root, selected workspace,
selected project, project mode, grid size, sidebar width, sort choices, and
review filters are stored in the app's own container or preferences.

No app preference is written to Ralphy's `activeWorkspace`. The app tolerates
that field while it still exists and continues to work after it is removed.

Review annotations remain atomically stored under
`.ralphy/media-library/library.json`. Unknown future fields are preserved where
possible, malformed data is never silently overwritten, and annotation writes
do not trigger project rescans.

## Failure Handling

- An invalid library selection leaves the previous library available.
- Missing or renamed workspaces and projects pop to the nearest valid route.
- One malformed workspace manifest, registry entry, generation line, or asset
  manifest cannot hide other projects.
- Unreadable files remain visible with an error state when their path is known.
- Scan failure preserves the latest successful immutable snapshot.
- Trash reports individual failures and never permanently deletes a file.
- Races with an external generator are retried after a short stability check.
- Cost parsing errors omit the cost instead of displaying a misleading value.

## Validation Strategy

Automated tests cover:

- workspace and project discovery, including unregistered legacy projects
- derived activity ordering and pinning
- route transitions and app-local workspace restoration
- Ralphy entity classification
- lifecycle and next-step derivation
- generation-ledger parsing, spend totals, and safe per-file attribution
- selected-project-only scanning
- FSEvents path routing, debounce, and stale-result rejection
- thumbnail request cancellation and cache-key invalidation
- annotation migration and review commands
- in-place viewer state restoration
- Markdown rendered/source fallback
- Copy for Agent output
- Trash behavior through an isolated temporary library

Integration fixtures model multiple workspaces and simultaneous generation in
separate projects. Performance tests include a synthetic large library and
read-only measurement against the user's real `.ralphy` tree.

Completion requires:

- all Swift unit and integration tests pass
- Thread Sanitizer passes the concurrency suite
- debug and release builds succeed
- the packaged `.app` passes the launch smoke test
- the existing Electron package still builds
- the real-library benchmark meets or explicitly reports every budget
- the complete navigation, review, viewer, live-sync, and restore workflows are
  exercised in the running packaged application
- desktop and compact-window screenshots are visually inspected for clipping,
  overlap, and empty or incorrectly loaded previews
- the final packaged app is left open on the user's selected workspace

## Non-Goals

- Global asset browsing on startup
- Automatic use of Ralphy's deprecated `activeWorkspace`
- Cloud synchronization or accounts
- Editing source media content
- Permanent deletion or emptying Trash
- Runtime imports from sibling Ralphy repositories
- App Store signing, notarization, or sandbox distribution in this phase
