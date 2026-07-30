# Workspace-First Media Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the global media dump with a fast workspace-first Ralphy
workbench that loads one project at a time, understands Ralphy entities and
generation costs, and reviews assets in an in-place native viewer.

**Architecture:** Keep deterministic filesystem and Ralphy-contract parsing in
`RalphyMediaCore`, while the app owns route state, selected-project sessions,
native file watching, previews, and presentation. Startup builds only a shallow
workspace/project catalog; selecting a project creates the sole recursive media
index and lazily hydrates its generation ledger through a persistent cache.

**Tech Stack:** Swift 6, SwiftUI, AppKit, AVKit, PDFKit, QuickLookThumbnailing,
CoreServices/FSEvents, Foundation Markdown, Swift Testing, JSON/JSONL, POSIX
shell.

## Global Constraints

- Target macOS 14 or newer.
- Add no third-party runtime dependencies.
- Never read or write `.ralphy/config.json.activeWorkspace`.
- Startup must not recursively enumerate project media or construct a global
  `[MediaItem]`.
- Keep at most one selected-project scan active and reject stale results.
- Never parse the real library's roughly 4 GB of generation logs at startup.
- Never load `asset-manifest.json` at catalog level because manifests may embed
  multi-megabyte base64 values.
- Keep generated files read-only except for explicit Move to Trash.
- Preserve atomic review metadata under `.ralphy/media-library/library.json`.
- Keep source, tests, documentation, and UI copy in English.
- Preserve existing annotations and map `keep` to Approved and `maybe` to
  Shortlist in presentation.
- Keep filesystem traversal, JSONL parsing, and thumbnail decoding off the main
  actor.
- Use one contextual sidebar that transitions from workspaces to projects.
- Double-click opens an in-place viewer, never another application window.
- Restore grid mode, filter, selection, and scroll anchor after viewer Back.
- Run `gitleaks protect --staged --redact` before every commit.

---

### Task 1: Ralphy Domain Model And Review Vocabulary

**Files:**
- Create: `native/RalphyMedia/Sources/RalphyMediaCore/RalphyModels.swift`
- Modify: `native/RalphyMedia/Sources/RalphyMediaCore/MediaModels.swift`
- Modify: `native/RalphyMedia/Sources/RalphyMediaCore/AgentFeedback.swift`
- Modify: `native/RalphyMedia/Tests/RalphyMediaCoreTests/MediaAnnotationTests.swift`
- Modify: `native/RalphyMedia/Tests/RalphyMediaCoreTests/AgentFeedbackTests.swift`
- Create: `native/RalphyMedia/Tests/RalphyMediaCoreTests/RalphyModelsTests.swift`

**Interfaces:**
- Produces: `ProjectReference`, `RalphyEntityKind`, `ProjectPhase`,
  `GenerationAttribution`, enriched `MediaItem`, and
  `ReviewVerdict.displayName`.
- Consumes: existing annotation JSON values and `.ralphy`-relative paths.

- [ ] **Step 1: Write failing domain and annotation tests**

```swift
@Test func projectReferenceBuildsCanonicalPaths() {
    let project = ProjectReference(workspaceID: "nightmaker", projectID: "relaunch-001")
    #expect(project.relativePath == "workspaces/nightmaker/projects/relaunch-001")
}

@Test func reviewVocabularyPreservesStoredKeepAndMaybeValues() {
    #expect(ReviewVerdict.keep.rawValue == "keep")
    #expect(ReviewVerdict.keep.displayName == "Approved")
    #expect(ReviewVerdict.maybe.displayName == "Shortlist")
    #expect(ReviewVerdict.needsWork.rawValue == "needs-work")
}

@Test func feedbackIncludesRalphyEntityAndGenerationCost() {
    let item = mediaItem(
        entity: .generatedAsset,
        generation: GenerationAttribution(
            costUSD: 0.15,
            provider: "google",
            model: "gemini-image",
            generatedAt: Date(timeIntervalSince1970: 10)
        )
    )
    let text = AgentFeedback.render(items: [item], annotations: [:])
    #expect(text.contains("- entity: generated asset"))
    #expect(text.contains("- generation cost: $0.15"))
}
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cd native/RalphyMedia
swift test --filter RalphyModels
swift test --filter MediaAnnotation
swift test --filter AgentFeedback
```

Expected: compilation fails because the new domain types, `needsWork`, and
generation metadata do not exist.

- [ ] **Step 3: Add the core domain types**

Implement these public shapes in `RalphyModels.swift`:

```swift
public struct ProjectReference: Codable, Hashable, Sendable {
    public let workspaceID: String
    public let projectID: String
    public var relativePath: String {
        "workspaces/\(workspaceID)/projects/\(projectID)"
    }
}

public enum RalphyEntityKind: String, Codable, CaseIterable, Hashable, Sendable {
    case finalRender
    case generatedAsset
    case reference
    case unit
    case lifecycleDocument
    case productionFile
}

public enum ProjectPhase: String, Codable, CaseIterable, Hashable, Sendable {
    case brief, style, plan, scenario, prompts, assets, render
    case evaluation, repair, unit, postmortem, complete, unknown
}

public struct GenerationAttribution: Codable, Hashable, Sendable {
    public let costUSD: Double
    public let provider: String?
    public let model: String?
    public let generatedAt: Date?
}
```

Add `entity: RalphyEntityKind` and optional
`generation: GenerationAttribution?` to `MediaItem`, with default initializer
arguments so existing callers remain source-compatible.

- [ ] **Step 4: Extend verdict and feedback behavior**

Add `case needsWork = "needs-work"` without changing existing raw values.
Expose stable display names:

```swift
public var displayName: String {
    switch self {
    case .unreviewed: "Unreviewed"
    case .keep: "Approved"
    case .maybe: "Shortlist"
    case .needsWork: "Needs Work"
    case .reject: "Reject"
    }
}
```

Render entity, cost, provider/model, and generated timestamp in
`AgentFeedback`. Escape embedded newlines in notes so a multi-selection remains
valid compact Markdown.

- [ ] **Step 5: Run tests and commit**

```bash
swift test --filter RalphyModels
swift test --filter MediaAnnotation
swift test --filter AgentFeedback
git add Sources/RalphyMediaCore Tests/RalphyMediaCoreTests
gitleaks protect --staged --redact
git commit -m "feat: model Ralphy media entities"
```

### Task 2: Shallow Workspace And Project Catalog

**Files:**
- Create: `native/RalphyMedia/Sources/RalphyMediaCore/WorkspaceCatalog.swift`
- Create: `native/RalphyMedia/Tests/RalphyMediaCoreTests/WorkspaceCatalogTests.swift`
- Create: `native/RalphyMedia/Tests/RalphyMediaCoreTests/TestSupport.swift`
- Modify: `native/RalphyMedia/Tests/RalphyMediaCoreTests/MediaScannerTests.swift`

**Interfaces:**
- Produces: `WorkspaceSummary`, `ProjectSummary`,
  `WorkspaceCatalogSnapshot`, and `WorkspaceCatalogScanner.scan(root:)`.
- Consumes: `ProjectReference`, `registry.json`, `workspace.json`, direct
  project children, and filesystem metadata.

- [ ] **Step 1: Move the reusable temporary fixture**

Move `TemporaryRalphy` from `MediaScannerTests.swift` into `TestSupport.swift`
without changing its `make()`, `write(_:bytes:)`, or `write(_:string:)`
signatures. Run the scanner tests to prove the test-only refactor is green:

```bash
swift test --filter MediaScanner
```

- [ ] **Step 2: Write failing catalog tests**

```swift
@Test func catalogDiscoversRegisteredAndLegacyProjectsWithoutMediaTraversal() throws {
    let root = try TemporaryRalphy.make()
    try root.write("registry.json", string: registryFixture)
    try root.write("workspaces/nightmaker/workspace.json", string: workspaceFixture)
    try root.write("workspaces/nightmaker/projects/registered/render/final.mp4", bytes: [1])
    try root.write("workspaces/nightmaker/projects/legacy/artifacts/images/a.png", bytes: [1])

    let snapshot = try WorkspaceCatalogScanner().scan(root: root.url)

    #expect(snapshot.workspaces.map(\.id) == ["nightmaker"])
    #expect(snapshot.projects(in: "nightmaker").map(\.id.projectID) == ["registered", "legacy"])
    #expect(snapshot.projects(in: "nightmaker").first { $0.id.projectID == "registered" }?.hasFinalRender == true)
}

@Test func catalogSortsByDerivedActivityAndDoesNotOpenAssetManifest() throws {
    let root = try TemporaryRalphy.make()
    try root.write("workspaces/ws/projects/new/logs/generations.jsonl", bytes: [0])
    try root.write("workspaces/ws/projects/old/asset-manifest.json", string: "{not-json")
    try setModificationDate(newDate, at: root.url.appending(path: "workspaces/ws/projects/new/logs/generations.jsonl"))

    let snapshot = try WorkspaceCatalogScanner().scan(root: root.url)

    #expect(snapshot.projects(in: "ws").map(\.id.projectID) == ["new", "old"])
    #expect(snapshot.warnings.isEmpty)
}
```

The second test deliberately creates an invalid manifest. A shallow catalog
must not read it or recursively enumerate its asset tree.

- [ ] **Step 3: Run catalog tests and verify RED**

```bash
swift test --filter WorkspaceCatalog
```

Expected: compilation fails because the scanner and summary types do not exist.

- [ ] **Step 4: Implement tolerant shallow discovery**

Define:

```swift
public struct WorkspaceSummary: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let description: String?
    public let projectCount: Int
    public let sharedAssetCount: Int
    public let unitCount: Int
    public let lastActivityAt: Date?
}

public struct ProjectSummary: Identifiable, Hashable, Sendable {
    public let id: ProjectReference
    public let name: String
    public let brief: String?
    public let status: String?
    public let phase: ProjectPhase
    public let lastActivityAt: Date?
    public let hasFinalRender: Bool
    public let unitCount: Int
    public let knownSpendUSD: Double?
}

public struct WorkspaceCatalogSnapshot: Sendable {
    public let workspaces: [WorkspaceSummary]
    public let projectsByWorkspace: [String: [ProjectSummary]]
    public let warnings: [String]
    public func projects(in workspaceID: String) -> [ProjectSummary]
}
```

Read `registry.json` once with tolerant optional fields. Enumerate only
`workspaces/*`, `workspaces/*/projects/*`, direct project files, and known
metadata paths. Count only direct children of workspace-level `shared` and
`units` directories for the dashboard. Use directory and log modification dates for the initial
activity estimate, derive phase from direct lifecycle markers, and sort newest
first with localized name and ID tie-breakers. Catch malformed metadata per
file and append a concise warning without dropping sibling projects.

- [ ] **Step 5: Prove the scanner stays shallow**

Add this injected filesystem boundary and a test double that records directory
enumerations:

```swift
public struct CatalogFileSystem: Sendable {
    public var directoryChildren: @Sendable (URL) throws -> [URL]
    public var metadata: @Sendable (URL) throws -> CatalogPathMetadata?
    public var readData: @Sendable (URL, Int) throws -> Data
}

public init(fileSystem: CatalogFileSystem = .live)
```

Assert that `directoryChildren` is never called for a path below a project's
`artifacts`, `render`, or `units` directory. Direct `metadata` probes for known
files and directories remain allowed.

Run:

```bash
swift test --filter WorkspaceCatalog
```

Expected: all catalog tests pass and the recorded traversal contains only
workspace/project directory levels and direct metadata probes.

- [ ] **Step 6: Commit**

```bash
git add Sources/RalphyMediaCore Tests/RalphyMediaCoreTests
gitleaks protect --staged --redact
git commit -m "feat: add shallow workspace catalog"
```

### Task 3: Selected-Project Scanner And Entity Queries

**Files:**
- Modify: `native/RalphyMedia/Sources/RalphyMediaCore/MediaScanner.swift`
- Modify: `native/RalphyMedia/Sources/RalphyMediaCore/MediaQuery.swift`
- Modify: `native/RalphyMedia/Tests/RalphyMediaCoreTests/MediaScannerTests.swift`
- Modify: `native/RalphyMedia/Tests/RalphyMediaCoreTests/MediaQueryTests.swift`

**Interfaces:**
- Produces: `MediaScanner.scan(project:root:options:attributions:)`,
  `ProjectMode`, and entity/folder grouping.
- Consumes: catalog `ProjectReference`, generation attributions from Task 4,
  and current media extension rules.

- [ ] **Step 1: Write failing project-scope and classification tests**

```swift
@Test func scannerIndexesOnlyTheRequestedProjectAndClassifiesEntities() throws {
    let root = try TemporaryRalphy.make()
    try root.write("workspaces/ws/projects/one/render/final.mp4", bytes: [1])
    try root.write("workspaces/ws/projects/one/artifacts/refs/logo.png", bytes: [1])
    try root.write("workspaces/ws/projects/one/artifacts/images/shot.png", bytes: [1])
    try root.write("workspaces/ws/projects/one/units/ad-01/video.mp4", bytes: [1])
    try root.write("workspaces/ws/projects/one/BRIEF.md", string: "# Brief")
    try root.write("workspaces/ws/projects/two/artifacts/images/other.png", bytes: [1])

    let result = try MediaScanner().scan(
        project: ProjectReference(workspaceID: "ws", projectID: "one"),
        root: root.url
    )

    #expect(result.items.map(\.project) == Array(repeating: "one", count: 5))
    #expect(result.items.first { $0.filename == "final.mp4" }?.entity == .finalRender)
    #expect(result.items.first { $0.filename == "logo.png" }?.entity == .reference)
    #expect(result.items.first { $0.filename == "shot.png" }?.entity == .generatedAsset)
    #expect(result.items.first { $0.relativePath.contains("/units/") }?.entity == .unit)
    #expect(result.items.first { $0.filename == "BRIEF.md" }?.entity == .lifecycleDocument)
}
```

- [ ] **Step 2: Write failing project-mode query tests**

Add `ProjectMode` cases `overview`, `finals`, `assets`, `refs`, `units`, and
`files`. Assert each non-overview mode filters by `MediaItem.entity`, and add
`MediaGroup.entity` plus `MediaGroup.folder` tests.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
swift test --filter MediaScanner
swift test --filter MediaQuery
```

Expected: compilation fails on the project scan overload, entity field, project
mode, and grouping cases.

- [ ] **Step 4: Implement project-only traversal**

Resolve the project directory from `ProjectReference.relativePath`, reject
missing or escaping paths, and reuse the current extension and pruning rules.
Classify from the project-relative path with this precedence:

```swift
switch components {
case let parts where parts.first == "render":
    return .finalRender
case let parts where parts.starts(with: ["artifacts", "refs"]):
    return .reference
case let parts where parts.first == "artifacts":
    return .generatedAsset
case let parts where parts.first == "units":
    return .unit
case let parts where lifecycleDocumentNames.contains(parts.last ?? ""):
    return .lifecycleDocument
default:
    return .productionFile
}
```

Attach an attribution by normalized project-relative output path. Preserve the
global `scan(root:)` overload only for the `--scan-only` diagnostic; the app
must use the project overload.

- [ ] **Step 5: Implement mode filtering and visible grouping**

Add `mode: ProjectMode` to `MediaQuery` and apply mode before review/search/type
filters. Replace workspace/project grouping in the project UI with entity and
first project-relative folder grouping, while retaining stable sorting.

- [ ] **Step 6: Run tests and commit**

```bash
swift test --filter MediaScanner
swift test --filter MediaQuery
git add Sources/RalphyMediaCore Tests/RalphyMediaCoreTests
gitleaks protect --staged --redact
git commit -m "feat: scan one Ralphy project at a time"
```

### Task 4: Lazy Generation Ledger And Persistent Cost Cache

**Files:**
- Create: `native/RalphyMedia/Sources/RalphyMediaCore/GenerationLedger.swift`
- Create: `native/RalphyMedia/Tests/RalphyMediaCoreTests/GenerationLedgerTests.swift`

**Interfaces:**
- Produces: `GenerationLedgerSummary` and actor
  `GenerationLedgerIndex.summary(for:root:)`.
- Consumes: append-only `logs/generations.jsonl` and `ProjectReference`.

- [ ] **Step 1: Write failing ledger parsing tests**

```swift
@Test func ledgerSumsSpendAndAttributesOutputsWithoutRetainingPayloads() async throws {
    let root = try TemporaryRalphy.make()
    let project = ProjectReference(workspaceID: "ws", projectID: "p")
    try root.write(
        "\(project.relativePath)/logs/generations.jsonl",
        string: [
            generationLine(cost: 0.15, output: "artifacts/images/a.png"),
            generationLine(cost: 0.20, output: "artifacts/voiceover/a.mp3"),
            "{malformed",
        ].joined(separator: "\n") + "\n"
    )
    let cache = root.url.appending(path: "cache")
    let index = GenerationLedgerIndex(cacheDirectory: cache)

    let summary = await index.summary(for: project, root: root.url)

    #expect(summary.totalSpendUSD == 0.35)
    #expect(summary.attributions["artifacts/images/a.png"]?.costUSD == 0.15)
    #expect(summary.malformedLineCount == 1)
}
```

- [ ] **Step 2: Write failing incremental-cache tests**

Index two records, append a third, and inject a byte-reader spy. Assert the
second call starts at the cached complete-line offset rather than reading the
original bytes. Truncate the source log and assert the next call performs a
clean rebuild.

- [ ] **Step 3: Run ledger tests and verify RED**

```bash
swift test --filter GenerationLedger
```

Expected: compilation fails because the index and summary do not exist.

- [ ] **Step 4: Implement bounded streaming and cache semantics**

Define:

```swift
public struct GenerationLedgerSummary: Codable, Sendable {
    public let totalSpendUSD: Double
    public let lastActivityAt: Date?
    public let attributions: [String: GenerationAttribution]
    public let malformedLineCount: Int
    public let indexedByteOffset: UInt64
}

public actor GenerationLedgerIndex {
    public init(cacheDirectory: URL)
    public func summary(
        for project: ProjectReference,
        root: URL
    ) async -> GenerationLedgerSummary
    public func invalidate(_ project: ProjectReference)
}
```

Read with `FileHandle` in fixed-size chunks, emit one complete JSONL record at a
time, and decode only optional `timestamp`, `provider`, `model`, `kind`,
`cost_usd`, `status`, and nested `output.local`. Do not retain decoded input,
base64, URL, prompt, or response fields. Normalize absolute and project-relative
output paths to project-relative keys. Sum finite nonnegative costs and keep the
latest successful attribution for each output.

Persist one atomic cache file per hashed project reference containing the
source path, source size, source modification time, last complete-line offset,
total, latest timestamp, and attributions. Resume only when the same log has
grown from the cached offset; rebuild after truncation, replacement, or corrupt
cache. Parsing errors increment `malformedLineCount` and never fail the project.

- [ ] **Step 5: Run tests, inspect memory behavior, and commit**

```bash
swift test --filter GenerationLedger
swift test
git add Sources/RalphyMediaCore Tests/RalphyMediaCoreTests
gitleaks protect --staged --redact
git commit -m "feat: index generation costs lazily"
```

### Task 5: Route State, App Preferences, And Targeted FSEvents

**Files:**
- Create: `native/RalphyMedia/Sources/RalphyMediaApp/WorkbenchNavigation.swift`
- Modify: `native/RalphyMedia/Sources/RalphyMediaApp/AppSettings.swift`
- Modify: `native/RalphyMedia/Sources/RalphyMediaApp/FolderWatcher.swift`
- Create: `native/RalphyMedia/Tests/RalphyMediaAppTests/WorkbenchNavigationTests.swift`
- Modify: `native/RalphyMedia/Tests/RalphyMediaAppTests/AppSettingsTests.swift`
- Create: `native/RalphyMedia/Tests/RalphyMediaAppTests/FolderChangeRoutingTests.swift`

**Interfaces:**
- Produces: `WorkbenchRoute`, `ProjectPresentationState`,
  `FolderChangeRouter.route(paths:root:)`, and path-bearing watcher callbacks.
- Consumes: project references and app-local `UserDefaults`.

- [ ] **Step 1: Write failing route and restore tests**

```swift
@Test func routeBackPopsAssetProjectWorkspaceInOrder() {
    let project = ProjectReference(workspaceID: "ws", projectID: "p")
    var navigation = WorkbenchNavigation()
    navigation.enterWorkspace("ws")
    navigation.enterProject(project)
    navigation.openAsset(id: "workspaces/ws/projects/p/render/final.mp4")

    #expect(navigation.goBack() == .project(project))
    #expect(navigation.goBack() == .workspace("ws"))
    #expect(navigation.goBack() == .library)
}

@Test func projectPresentationStateRestoresGridContext() {
    let state = ProjectPresentationState(
        mode: .assets,
        query: MediaQuery(search: "hook", sort: .newest, group: .entity),
        selectedIDs: ["a"],
        scrollAnchorID: "a"
    )
    #expect(state.scrollAnchorID == "a")
    #expect(state.query.search == "hook")
}
```

- [ ] **Step 2: Write failing app-local preference tests**

Round-trip `selectedWorkspaceID`, `selectedProjectID`, `projectMode`,
`workspaceSort`, pinned workspace/project ID sets, and sidebar width. Seed
`activeWorkspace` in the defaults suite and assert it is ignored.

- [ ] **Step 3: Write failing filesystem-routing tests**

```swift
@Test func routesChangesToOneProjectOrCatalog() {
    let root = URL(filePath: "/tmp/.ralphy")
    let changes = FolderChangeRouter.route(
        paths: [
            "/tmp/.ralphy/workspaces/ws/projects/p/artifacts/images/a.png",
            "/tmp/.ralphy/workspaces/ws/projects/q/logs/generations.jsonl",
        ],
        root: root
    )
    #expect(changes.projects == [
        ProjectReference(workspaceID: "ws", projectID: "p"),
        ProjectReference(workspaceID: "ws", projectID: "q"),
    ])
    #expect(!changes.catalogStructureChanged)
}
```

Also cover workspace/project directory creation, paths outside the root, and
annotation paths.

- [ ] **Step 4: Run tests and verify RED**

```bash
swift test --filter WorkbenchNavigation
swift test --filter AppSettings
swift test --filter FolderChangeRouting
```

Expected: compilation fails on the new navigation, settings, and routing types.

- [ ] **Step 5: Implement pure navigation and preferences**

`WorkbenchRoute` has `.library`, `.workspace(String)`,
`.project(ProjectReference)`, and `.asset(ProjectReference, String)`.
`WorkbenchNavigation` owns the current route plus project presentation states.
Entering a new workspace clears the selected project session; opening and
closing an asset preserves the stored state. Persist only stable IDs and
presentation options, never media arrays or the deprecated core setting.

- [ ] **Step 6: Forward and route real FSEvent paths**

Change `FolderWatcher` to call:

```swift
init(
    root: URL,
    onChange: @escaping @MainActor @Sendable ([String]) -> Void
)
```

Convert the callback's CFArray event paths to standardized strings. Coalesce
duplicate paths before crossing to the main actor. `FolderChangeRouter`
extracts workspace/project components and reports structural catalog changes
separately from project content changes.

- [ ] **Step 7: Run tests and commit**

```bash
swift test --filter WorkbenchNavigation
swift test --filter AppSettings
swift test --filter FolderChangeRouting
git add Sources/RalphyMediaApp Tests/RalphyMediaAppTests
gitleaks protect --staged --redact
git commit -m "feat: add workspace-first navigation state"
```

### Task 6: Selected-Project Library View Model

**Files:**
- Rewrite: `native/RalphyMedia/Sources/RalphyMediaApp/LibraryViewModel.swift`
- Create: `native/RalphyMedia/Sources/RalphyMediaApp/LibraryViewModel+Loading.swift`
- Create: `native/RalphyMedia/Sources/RalphyMediaApp/LibraryViewModel+Review.swift`
- Modify: `native/RalphyMedia/Tests/RalphyMediaAppTests/LibraryViewModelLiveSyncTests.swift`
- Modify: `native/RalphyMedia/Tests/RalphyMediaAppTests/LibraryViewModelResponsivenessTests.swift`

**Interfaces:**
- Produces: observable catalog, route, selected workspace/project session,
  project summaries, visible media, spend hydration, review actions, and
  targeted reloads.
- Consumes: Tasks 1-5 core and app interfaces.

- [ ] **Step 1: Add failing default-state and lazy-load tests**

Inject catalog scan, project scan, ledger load, and query closures into the view
model. Assert:

```swift
@Test @MainActor
func openingLibraryPublishesCatalogWithoutScanningMedia() async throws {
    let recorder = LoadRecorder()
    let model = LibraryViewModel(
        catalogScan: { root in
            await recorder.catalog()
            return catalogFixture
        },
        projectScan: { _, _, _, _ in
            await recorder.project()
            return ScanResult(items: [], skipped: 0)
        }
    )

    model.load(root: root.url)
    await eventually { model.workspaces.count == 2 }

    #expect(await recorder.catalogCount == 1)
    #expect(await recorder.projectCount == 0)
    #expect(model.route == .library)
    #expect(model.items.isEmpty)
}
```

Add tests proving selection of one project scans only that reference, rapid
project switching rejects the stale first result, and restoring a workspace
does not restore an invalid project.

- [ ] **Step 2: Add failing targeted live-sync tests**

Open project `p`, emit changes for `q`, and assert `p` is not rescanned. Emit an
asset change for `p` and assert one coalesced project refresh. Emit a new project
directory and assert only the catalog refreshes. Preserve selection for stable
IDs and remove selection for deleted IDs.

- [ ] **Step 3: Run view-model tests and verify RED**

```bash
swift test --filter LibraryViewModel
```

Expected: tests fail because current loading performs a global scan and the
new injected operations and route state are absent.

- [ ] **Step 4: Split state, loading, and review responsibilities**

Keep `LibraryViewModel` as the single `@MainActor ObservableObject`, but limit
the main file to published state, initialization, navigation, query state, and
computed selection. Move root/catalog/project/watcher task orchestration to
`LibraryViewModel+Loading.swift`; move the proven annotation save, clipboard,
Trash, and termination flows to `LibraryViewModel+Review.swift`.

The published loading state is:

```swift
@Published private(set) var catalog = WorkspaceCatalogSnapshot.empty
@Published private(set) var navigation = WorkbenchNavigation()
@Published private(set) var items: [MediaItem] = []
@Published private(set) var visibleSections: [MediaSection] = []
@Published private(set) var selectedIDs: Set<String> = []
@Published private(set) var isLoadingCatalog = false
@Published private(set) var isLoadingProject = false
@Published private(set) var isLoadingCosts = false
@Published private(set) var projectSpendUSD: Double?
```

Use independent catalog, project, ledger, and query generations. Project
selection immediately publishes the route and empty/loading surface, starts the
project scan off-main, then starts ledger hydration. When ledger attribution
arrives, rescan/redecorate only the selected project's in-memory items and
republish the current query.

- [ ] **Step 5: Preserve review safety while changing scopes**

Retain atomic metadata writes, stale-revision conflict handling, termination
waiting, nonblocking partial Trash reconciliation, and batch annotation
commands. Extend status counts to the current project only. `copyForAgent()`
uses enriched selected items. `openSelection()` remains an explicit context
menu command but double-click no longer calls it or Quick Look.

- [ ] **Step 6: Implement route and grid restoration APIs**

Expose:

```swift
func enterWorkspace(_ id: String)
func enterProject(_ project: ProjectReference)
func openAsset(_ item: MediaItem)
func goBack()
func showPreviousAsset()
func showNextAsset()
func updateScrollAnchor(_ id: String?)
func setProjectMode(_ mode: ProjectMode)
```

Before opening an asset, save query, selected IDs, and current scroll anchor.
On Back, restore those values before the grid reappears.

- [ ] **Step 7: Run the full test suite and commit**

```bash
swift test
swift build
git add Sources/RalphyMediaApp Tests/RalphyMediaAppTests
gitleaks protect --staged --redact
git commit -m "feat: load one active Ralphy project"
```

### Task 7: Contextual Sidebar, Dashboards, And Project Surface

**Files:**
- Create: `native/RalphyMedia/Sources/RalphyMediaApp/RalphyTheme.swift`
- Rewrite: `native/RalphyMedia/Sources/RalphyMediaApp/SidebarView.swift`
- Create: `native/RalphyMedia/Sources/RalphyMediaApp/WorkspaceDashboardView.swift`
- Create: `native/RalphyMedia/Sources/RalphyMediaApp/ProjectOverviewView.swift`
- Create: `native/RalphyMedia/Sources/RalphyMediaApp/ProjectSurfaceView.swift`
- Modify: `native/RalphyMedia/Sources/RalphyMediaApp/LibraryWindow.swift`
- Modify: `native/RalphyMedia/Sources/RalphyMediaApp/MediaGridView.swift`
- Modify: `native/RalphyMedia/Sources/RalphyMediaApp/InspectorView.swift`
- Modify: `native/RalphyMedia/Tests/RalphyMediaAppTests/MediaLibraryUIHelpersTests.swift`

**Interfaces:**
- Produces: single transitioning sidebar, library/workspace dashboards, visible
  project modes and filters, Ralphy visual tokens, and project-scoped grid.
- Consumes: Task 6 view-model state and actions.

- [ ] **Step 1: Add failing presentation helper tests**

Test workspace/project sort descriptors, human-readable activity strings,
phase labels, spend formatting, and project-mode/entity mappings as pure
helpers:

```swift
@Test func recentProjectsSortNewestThenName() {
    let sorted = ProjectPresentation.sorted(
        [olderB, newest, olderA],
        by: .recent,
        pinned: []
    )
    #expect(sorted.map(\.id.projectID) == ["newest", "older-a", "older-b"])
}

@Test func visibleFilterSummaryNamesEveryActiveChoice() {
    let text = ProjectPresentation.filterSummary(
        mode: .assets,
        bucket: .video,
        verdict: .keep,
        sort: .newest,
        group: .entity
    )
    #expect(text == "Assets · Video · Approved · Newest · Entity")
}
```

- [ ] **Step 2: Run helper tests and verify RED**

```bash
swift test --filter MediaLibraryUIHelpers
```

Expected: compilation fails on the new presentation helpers.

- [ ] **Step 3: Add explicit Ralphy design tokens**

Create semantic colors for graphite surfaces, warm primary text, dusty-rose
focus/selection, amber lifecycle/spend, and approved/rejected states. Use
system UI fonts and `.monospaced()` only for paths, IDs, timing, and cost.
Provide reusable 4/6/8/12/16-point spacing constants and an 8-point maximum
corner radius.

- [ ] **Step 4: Replace the sidebar with one contextual list**

At `.library`, show searchable workspace rows with project count and activity.
At `.workspace`, `.project`, or `.asset`, replace those rows with projects from
the selected workspace and show a back button in the sidebar header. Sort by
recent activity by default, keep pin controls in row context menus, and expose
the active sort label. Do not render workspace and project lists
simultaneously.

- [ ] **Step 5: Build the library and workspace dashboards**

The library surface shows recent workspaces and aggregate catalog counts in
unframed rows. The workspace surface shows recent projects, final-render state,
known spend, phase distribution, and workspace-level `shared`/`units`
shortcuts. Unknown lazy costs display an em-free placeholder such as `Cost not
indexed`, never `$0.00`.

- [ ] **Step 6: Build the project header, overview, and visible controls**

Use a compact project header followed by a segmented picker with
`Overview`, `Finals`, `Assets`, `Refs`, `Units`, and `Files`. In grid modes,
place search, media type, review status, `Sort: <value>`,
`Group: <value>`, intermediate toggle, and grid-size control in one wrapping
control strip. Every active choice must be readable without opening a menu.

- [ ] **Step 7: Adapt the grid and inspector**

The grid consumes only current-project sections. Tiles show entity/status
marks, rating/favorite, duration when known, and generation cost when
attributed. Remove double-click Quick Look and call `openAsset(_:)`. Keep
stable aspect ratios and cancellation-aware `.task` thumbnail loading.
The inspector becomes metadata/review only and does not create a second heavy
preview while the immersive viewer is visible.

- [ ] **Step 8: Build, run tests, and commit**

```bash
swift test
swift build
git add Sources/RalphyMediaApp Tests/RalphyMediaAppTests
gitleaks protect --staged --redact
git commit -m "feat: deliver workspace-first Ralphy interface"
```

### Task 8: In-Place Viewer, Markdown, And Native Back Input

**Files:**
- Create: `native/RalphyMedia/Sources/RalphyMediaApp/AssetViewer.swift`
- Create: `native/RalphyMedia/Sources/RalphyMediaApp/MarkdownPreview.swift`
- Create: `native/RalphyMedia/Sources/RalphyMediaApp/MouseNavigationMonitor.swift`
- Modify: `native/RalphyMedia/Sources/RalphyMediaApp/MediaPreview.swift`
- Modify: `native/RalphyMedia/Sources/RalphyMediaApp/LibraryWindow.swift`
- Modify: `native/RalphyMedia/Sources/RalphyMediaApp/RalphyMediaApp.swift`
- Modify: `native/RalphyMedia/Tests/RalphyMediaAppTests/PreviewTextReaderTests.swift`
- Create: `native/RalphyMedia/Tests/RalphyMediaAppTests/MarkdownPreviewTests.swift`
- Create: `native/RalphyMedia/Tests/RalphyMediaAppTests/MouseNavigationTests.swift`

**Interfaces:**
- Produces: immersive same-window viewer, rendered/source Markdown, reusable
  media playback, and mouse/keyboard Back.
- Consumes: Task 6 route and adjacent-asset actions.

- [ ] **Step 1: Write failing Markdown and mouse mapping tests**

```swift
@Test func markdownRendererProducesAttributedContentAndFallsBackToSource() {
    let rendered = MarkdownRenderer.render("# Title\n\n**Bold**")
    #expect(rendered.plainText.contains("Title"))
    #expect(rendered.plainText.contains("Bold"))
}

@Test func mouseButtonMappingUsesThumbButtonsForHistory() {
    #expect(MouseNavigationAction(buttonNumber: 3) == .back)
    #expect(MouseNavigationAction(buttonNumber: 4) == .forward)
    #expect(MouseNavigationAction(buttonNumber: 2) == nil)
}
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
swift test --filter MarkdownPreview
swift test --filter MouseNavigation
```

Expected: compilation fails because the renderer and mouse mapping do not
exist.

- [ ] **Step 3: Implement rendered/source Markdown**

Reuse the bounded `PreviewLoader` text read. Convert Markdown with
`AttributedString(markdown:options:)`, preserve code with monospaced
presentation, and expose a `Rendered / Source` segmented control for `.md` and
`.markdown`. On parse failure, show the source and a compact nonmodal warning.

- [ ] **Step 4: Build the in-place viewer**

When the route is `.asset`, replace `ProjectSurfaceView` with `AssetViewer`.
Use the current `MediaPreview` for image, video, audio, text, and PDF. The
viewer toolbar contains Back, previous/next, filename, review status, favorite,
Copy for Agent, Reveal in Finder, and Trash. Arrow navigation updates metadata
immediately and cancels stale heavy preview loads.

- [ ] **Step 5: Add native navigation inputs**

Register one local `.otherMouseDown` monitor while the window is active. Map
button 3 to `goBack()` and button 4 to forward/next only when the viewer can
handle it; return unrelated events untouched and remove the monitor on
disappear. Add `Command-[` Back and `Command-]` Forward commands. Keep Space as
play/pause or Quick Look only within the current viewer.

- [ ] **Step 6: Run tests, build, and commit**

```bash
swift test
swift build
git add Sources/RalphyMediaApp Tests/RalphyMediaAppTests
gitleaks protect --staged --redact
git commit -m "feat: add in-place asset viewer"
```

### Task 9: Thumbnail Budget, Branding, Benchmarks, And Final Verification

**Files:**
- Modify: `native/RalphyMedia/Sources/RalphyMediaApp/ThumbnailStore.swift`
- Modify: `native/RalphyMedia/Sources/RalphyMediaApp/RalphyMediaApp.swift`
- Modify: `native/RalphyMedia/Resources/AppIcon.png`
- Modify: `native/RalphyMedia/scripts/test-app.sh`
- Create: `native/RalphyMedia/scripts/benchmark-library.sh`
- Modify: `native/RalphyMedia/README.md`
- Modify: `README.md`
- Modify only implementation files required by measured failures.

**Interfaces:**
- Produces: bounded preview memory, Ralphy-branded package, reproducible
  performance evidence, passing full suite, and running final app.
- Consumes: every prior task.

- [ ] **Step 1: Add a catalog/project benchmark mode**

Extend the executable diagnostics:

```text
--catalog-only <.ralphy>
--project-scan <.ralphy> <workspace> <project>
```

Print machine-readable JSON with elapsed milliseconds, workspace/project/item
counts, and skipped files. `benchmark-library.sh` runs each mode three times,
records cold/warm results, and fails if startup recursively reports media items
or the representative 150-file project exceeds 300 ms excluding thumbnails.

- [ ] **Step 2: Bound thumbnail memory and remove obsolete work**

Reduce the decoded thumbnail cache to a measured native budget, include target
pixel size in every key, cancel offscreen requests, and clear project-specific
in-flight preview state on project changes. Use Instruments or `footprint` to
compare memory after switching through ten projects; retain the smallest cache
that keeps reverse navigation responsive.

- [ ] **Step 3: Apply Ralphy branding without sibling runtime dependencies**

Create a self-contained app icon from the Ralphy mascot and graphite/rose/amber
palette. Vendor only the final generated resource into this repository. Do not
load fonts, SVGs, CSS, or images from sibling checkouts at runtime.

- [ ] **Step 4: Run automated verification**

```bash
cd native/RalphyMedia
swift test
swift build
swift build -c release
swift test --sanitize=thread
./scripts/build-app.sh
./scripts/test-app.sh /Users/maximovchinnikov/github/ralphy/ralphy/.ralphy
./scripts/benchmark-library.sh /Users/maximovchinnikov/github/ralphy/ralphy/.ralphy
cd ../..
bun run build
```

Expected: every command succeeds, tests remain race-free, launch smoke test
finds the packaged process, and benchmark output reports actual values against
the budgets.

- [ ] **Step 5: Exercise the packaged app on the real library**

Open the real `.ralphy`, verify the first screen contains no all-assets grid,
enter a recent workspace and project, switch every project mode, inspect cost
hydration, generate or copy a temporary media fixture into the selected
project, and confirm it appears within one second. Verify Markdown render/source
mode, adjacent viewer navigation, mouse Back restoring the grid anchor,
Approved/Shortlist/Needs Work/Reject, tags, Copy for Agent, and Trash using only
the temporary fixture.

- [ ] **Step 6: Inspect desktop and compact-window screenshots**

Capture at 1440x900 and the minimum 1100x720 window. Check text fit, sidebar
transition, visible filter state, grid stability, viewer framing, Markdown,
dark/light contrast, and absence of overlapping or blank media. Fix only
verified issues and rerun affected tests.

- [ ] **Step 7: Request independent review and resolve findings**

Give the reviewer the design, this plan, branch diff, test output, benchmark
JSON, and screenshots. Resolve every Critical or Important finding, rerun its
focused test, then repeat Step 4.

- [ ] **Step 8: Run repository safety checks**

```bash
rg --pcre2 '\p{Cyrillic}' --hidden -g '!.git' -g '!node_modules' -g '!*.lock' -g '!native/RalphyMedia/.build' -g '!native/RalphyMedia/dist' -g '!.superpowers'
gitleaks detect --source .
git status --short
```

Expected: no Cyrillic source/UI copy, no leaked secrets, and only intentional
temporary visual-companion files remain untracked.

- [ ] **Step 9: Package and leave the final application open**

Rebuild `dist/Ralphy Media.app`, close obsolete instances, launch one fresh
instance against the real library, select the most recently used app-local
workspace, and confirm the workspace dashboard is frontmost and responsive.

## Self-Review

- Spec coverage: the tasks cover contextual workspace/project navigation,
  app-local selection, shallow startup, selected-project indexing, targeted
  live sync, Ralphy entities/lifecycle, lazy spend and per-file cost, visible
  controls, review states, Copy for Agent, Trash, in-place Back navigation,
  Markdown, Codex-like density, Ralphy palette, persistence, compatibility,
  failure isolation, packaging, performance budgets, and final UI validation.
- Placeholder scan: the plan contains no incomplete implementation markers or
  deferred behavior.
- Type consistency: `ProjectReference`, `RalphyEntityKind`, `ProjectPhase`,
  `GenerationAttribution`, `WorkspaceCatalogSnapshot`, `ProjectMode`,
  `GenerationLedgerIndex`, `WorkbenchRoute`, and the view-model APIs use the
  same names and signatures across producer and consumer tasks.
