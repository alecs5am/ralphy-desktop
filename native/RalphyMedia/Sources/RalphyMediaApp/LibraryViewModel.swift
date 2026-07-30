import AppKit
import Foundation
import RalphyMediaCore

enum LibrarySmartSource: Hashable, Sendable {
    case all
    case usable
    case verdict(ReviewVerdict)
    case favorites
    case workspace(String)
    case project(String)
}

enum LibrarySourceQuery {
    static func applying(
        _ source: LibrarySmartSource,
        to query: MediaQuery
    ) -> MediaQuery {
        var updated = query
        updated.verdict = nil
        updated.favoriteOnly = false
        updated.excludeRejected = false

        switch source {
        case .all, .workspace, .project:
            break
        case .usable:
            updated.excludeRejected = true
        case let .verdict(verdict):
            updated.verdict = verdict
        case .favorites:
            updated.favoriteOnly = true
        }
        return updated
    }

    static func selection(for query: MediaQuery) -> LibrarySmartSource {
        if query.favoriteOnly {
            return .favorites
        }
        if let verdict = query.verdict {
            return .verdict(verdict)
        }
        if query.excludeRejected {
            return .usable
        }
        return .all
    }
}

struct LibrarySourceCounts: Sendable {
    private let verdictCounts: [ReviewVerdict: Int]
    private let workspaceCounts: [String: Int]
    private let allProjectCounts: [String: Int]
    private let projectCountsByWorkspace: [String: [String: Int]]
    let favoriteCount: Int

    init(
        items: [MediaItem] = [],
        annotations: [String: MediaAnnotation] = [:]
    ) {
        var verdictCounts = Dictionary(
            uniqueKeysWithValues: ReviewVerdict.allCases.map { ($0, 0) }
        )
        var workspaceCounts: [String: Int] = [:]
        var allProjectCounts: [String: Int] = [:]
        var projectCountsByWorkspace: [String: [String: Int]] = [:]
        var favoriteCount = 0
        for item in items {
            let annotation = annotations[item.relativePath]
            verdictCounts[annotation?.verdict ?? .unreviewed, default: 0] += 1
            favoriteCount += annotation?.favorite == true ? 1 : 0
            workspaceCounts[item.workspace, default: 0] += 1
            allProjectCounts[item.project, default: 0] += 1
            projectCountsByWorkspace[item.workspace, default: [:]][item.project, default: 0] += 1
        }
        self.verdictCounts = verdictCounts
        self.workspaceCounts = workspaceCounts
        self.allProjectCounts = allProjectCounts
        self.projectCountsByWorkspace = projectCountsByWorkspace
        self.favoriteCount = favoriteCount
    }

    func count(for verdict: ReviewVerdict) -> Int {
        verdictCounts[verdict, default: 0]
    }

    var workspaces: [(String, Int)] {
        sorted(workspaceCounts)
    }

    func projects(in workspace: String?) -> [(String, Int)] {
        sorted(workspace.flatMap { projectCountsByWorkspace[$0] } ?? allProjectCounts)
    }

    private func sorted(_ counts: [String: Int]) -> [(String, Int)] {
        counts
            .map { ($0.key, $0.value) }
            .sorted { $0.0.localizedStandardCompare($1.0) == .orderedAscending }
    }
}

struct TrashProgress: Equatable, Sendable {
    let completed: Int
    let total: Int
}

struct TrashFailure: Sendable {
    let filename: String
    let message: String
}

struct TrashBatchResult: Sendable {
    let trashedIDs: Set<String>
    let failures: [TrashFailure]
}

typealias CatalogScanOperation = @Sendable (URL) async throws -> WorkspaceCatalogSnapshot
typealias RootContextLoadOperation = @Sendable (
    URL
) async throws -> LibraryViewModel.LibraryContext
typealias ProjectScanOperation = @Sendable (
    ProjectReference,
    URL,
    ScanOptions,
    [String: GenerationAttribution]
) async throws -> ScanResult
typealias LedgerLoadOperation = @Sendable (
    ProjectReference,
    URL
) async -> GenerationLedgerSummary
typealias MediaQueryEvaluator = @Sendable (
    MediaQuery,
    [MediaItem],
    [String: MediaAnnotation]
) -> [MediaSection]
typealias TrashItemOperation = @Sendable (URL) throws -> Void
typealias AnnotationSaveOperation = @Sendable (MetadataStore) async throws -> MetadataStore

enum RootContextLoadError: Error {
    case invalidRoot
}

@MainActor
final class LibraryViewModel: ObservableObject {
    @Published private(set) var catalog = WorkspaceCatalogSnapshot.empty
    @Published private(set) var navigation = WorkbenchNavigation()
    @Published var rootURL: URL?
    @Published private(set) var items: [MediaItem] = []
    @Published var annotations: [String: MediaAnnotation] = [:]
    @Published private(set) var visibleSections: [MediaSection] = []
    @Published var visibleItems: [MediaItem] = []
    @Published private(set) var selectedIDs: Set<String> = []
    @Published var sourceCounts = LibrarySourceCounts()
    @Published private(set) var isLoadingCatalog = false
    @Published private(set) var isLoadingProject = false
    @Published private(set) var isLoadingCosts = false
    @Published private(set) var projectSpendUSD: Double?
    @Published var scanDuration: TimeInterval?
    @Published var statusText = "Open a .ralphy folder"
    @Published var pendingTrashConfirmation: [MediaItem]?
    @Published var trashProgress: TrashProgress?
    @Published var isApplyingQuery = false
    @Published var isTerminating = false
    @Published var quickLookURL: URL?
    @Published var errorMessage: String?

    @Published var query: MediaQuery {
        didSet {
            appSettings.bucket = query.bucket
            appSettings.sort = query.sort
            appSettings.group = query.group
            appSettings.verdict = query.verdict
            appSettings.favoriteOnly = query.favoriteOnly
            appSettings.excludeRejected = query.excludeRejected
            requestVisibleItemsUpdate(debounceSearch: query.search != oldValue.search)
        }
    }

    @Published var gridSize: Double {
        didSet { appSettings.gridSize = gridSize }
    }

    @Published var includeIntermediates: Bool {
        didSet {
            guard includeIntermediates != oldValue else { return }
            appSettings.includeIntermediates = includeIntermediates
            requestSelectedProjectRefresh()
        }
    }

    @Published var inspectorVisible: Bool {
        didSet { appSettings.inspectorVisible = inspectorVisible }
    }

    struct LibraryContext: Sendable {
        let root: URL
        var annotations: [String: MediaAnnotation]
        var store: MetadataStore?
        let metadataWarning: String?
    }

    struct ProjectScanRequest {
        let generation: UInt64
        let project: ProjectReference
        let root: URL
        let options: ScanOptions
        let attributions: [String: GenerationAttribution]
        let startsLedgerHydration: Bool
    }

    struct ProjectRefreshTarget {
        let project: ProjectReference
        let root: URL
    }

    struct QueryRequest {
        let generation: UInt64
        let query: MediaQuery
        let items: [MediaItem]
        let annotations: [String: MediaAnnotation]
        let debounceSearch: Bool
    }

    struct AnnotationSaveRequest {
        let generation: UInt64
        let store: MetadataStore
        let annotations: [String: MediaAnnotation]
    }

    enum AnnotationSaveOutcome {
        case saved
        case reloadRequired
        case retryableFailure
    }

    let appSettings: AppSettings
    let rootContextLoad: RootContextLoadOperation
    let catalogScan: CatalogScanOperation
    let projectScan: ProjectScanOperation
    let ledgerLoad: LedgerLoadOperation
    let queryEvaluator: MediaQueryEvaluator
    let trashItem: TrashItemOperation
    let annotationSave: AnnotationSaveOperation

    var desiredContext: LibraryContext?
    var store: MetadataStore?
    var watcher: FolderWatcher?
    var catalogGeneration: UInt64 = 0
    var projectGeneration: UInt64 = 0
    var ledgerGeneration: UInt64 = 0
    var queryGeneration: UInt64 = 0
    var rootLoadGeneration: UInt64 = 0
    var annotationSaveGeneration: UInt64 = 0
    var selectionAnchorID: String?
    var primarySelectionID: String?
    var currentScrollAnchorID: String?
    var currentAttributions: [String: GenerationAttribution] = [:]
    var rootContextTask: Task<Void, Never>?
    var catalogTask: Task<Void, Never>?
    var projectTask: Task<Void, Never>?
    var ledgerTask: Task<Void, Never>?
    var queryTask: Task<Void, Never>?
    var pendingProjectRequest: ProjectScanRequest?
    var pendingProjectRefreshTarget: ProjectRefreshTarget?
    var activeProjectGeneration: UInt64?
    var projectComputationInFlight = false
    var pendingQueryRequest: QueryRequest?
    var queryComputationInFlight = false
    var trashTask: Task<Void, Never>?
    var metadataSaveTasks: [URL: Task<Void, Never>] = [:]
    var pendingAnnotationSaves: [URL: AnnotationSaveRequest] = [:]

    var catalogState: WorkspaceCatalogSnapshot {
        get { catalog }
        set { catalog = newValue }
    }

    var navigationState: WorkbenchNavigation {
        get { navigation }
        set { navigation = newValue }
    }

    var projectItemsState: [MediaItem] {
        get { items }
        set { items = newValue }
    }

    var selectionState: Set<String> {
        get { selectedIDs }
        set { selectedIDs = newValue }
    }

    var catalogLoadingState: Bool {
        get { isLoadingCatalog }
        set { isLoadingCatalog = newValue }
    }

    var projectLoadingState: Bool {
        get { isLoadingProject }
        set { isLoadingProject = newValue }
    }

    var costsLoadingState: Bool {
        get { isLoadingCosts }
        set { isLoadingCosts = newValue }
    }

    var spendState: Double? {
        get { projectSpendUSD }
        set { projectSpendUSD = newValue }
    }

    lazy var catalogReloadCoalescer = ReloadCoalescer(
        delay: .milliseconds(450)
    ) { [weak self] in
        await self?.refreshCatalog()
    }

    lazy var projectReloadCoalescer = ReloadCoalescer(
        delay: .milliseconds(450)
    ) { [weak self] in
        await self?.refreshRequestedProject()
    }

    init(
        settings: AppSettings = AppSettings(),
        rootContextLoad: @escaping RootContextLoadOperation = { root in
            let root = root.standardizedFileURL
            var isDirectory: ObjCBool = false
            let workspacesURL = root.appending(path: "workspaces")
            guard root.lastPathComponent == ".ralphy",
                  FileManager.default.fileExists(
                    atPath: workspacesURL.path,
                    isDirectory: &isDirectory
                  ),
                  isDirectory.boolValue else {
                throw RootContextLoadError.invalidRoot
            }

            try Task.checkCancellation()
            do {
                let metadata = try MetadataStore(root: root)
                try Task.checkCancellation()
                return LibraryContext(
                    root: root,
                    annotations: metadata.annotations,
                    store: metadata,
                    metadataWarning: nil
                )
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                let metadataURL = root.appending(path: "media-library/library.json")
                let warning = "Could not read \(metadataURL.path). " +
                    "Media will remain visible, but annotation changes will not be saved: " +
                    error.localizedDescription
                return LibraryContext(
                    root: root,
                    annotations: [:],
                    store: nil,
                    metadataWarning: warning
                )
            }
        },
        queryEvaluator: @escaping MediaQueryEvaluator = { query, items, annotations in
            query.sections(from: items, annotations: annotations)
        },
        catalogScan: @escaping CatalogScanOperation = { root in
            try WorkspaceCatalogScanner().scan(root: root)
        },
        projectScan: @escaping ProjectScanOperation = { project, root, options, attributions in
            try MediaScanner().scan(
                project: project,
                root: root,
                options: options,
                attributions: attributions
            )
        },
        ledgerLoad: LedgerLoadOperation? = nil,
        trashItem: @escaping TrashItemOperation = { url in
            var resultingURL: NSURL?
            try FileManager.default.trashItem(at: url, resultingItemURL: &resultingURL)
        },
        annotationSave: AnnotationSaveOperation? = nil
    ) {
        appSettings = settings
        self.rootContextLoad = rootContextLoad
        self.queryEvaluator = queryEvaluator
        self.catalogScan = catalogScan
        self.projectScan = projectScan
        self.trashItem = trashItem
        self.ledgerLoad = ledgerLoad ?? { project, root in
            let index = GenerationLedgerIndex(
                cacheDirectory: root.appending(path: "media-library/cache")
            )
            return await index.summary(for: project, root: root)
        }
        if let annotationSave {
            self.annotationSave = annotationSave
        } else {
            let coordinator = MetadataSaveCoordinator()
            self.annotationSave = { store in
                let save = await coordinator.submit(store)
                return try await save.value
            }
        }
        query = MediaQuery(
            verdict: settings.verdict,
            excludeRejected: settings.excludeRejected,
            favoriteOnly: settings.favoriteOnly,
            mode: settings.projectMode,
            bucket: settings.bucket,
            sort: settings.sort,
            group: settings.group
        )
        gridSize = settings.gridSize
        includeIntermediates = settings.includeIntermediates
        inspectorVisible = settings.inspectorVisible
        requestVisibleItemsUpdate()
    }

    var route: WorkbenchRoute {
        navigation.route
    }

    var selectedProjectReference: ProjectReference? {
        switch route {
        case let .project(project), let .asset(project, _):
            project
        case .library, .workspace:
            nil
        }
    }

    var selectedWorkspaceID: String? {
        switch route {
        case let .workspace(id):
            id
        case let .project(project), let .asset(project, _):
            project.workspaceID
        case .library:
            nil
        }
    }

    var workspaceSummaries: [WorkspaceSummary] {
        catalog.workspaces
    }

    var projectSummaries: [ProjectSummary] {
        selectedWorkspaceID.map(catalog.projects(in:)) ?? []
    }

    var workspaces: [(String, Int)] {
        catalog.workspaces.map { ($0.id, $0.projectCount) }
    }

    var projects: [(String, Int)] {
        projectSummaries.map { summary in
            let count = summary.id == selectedProjectReference ? items.count : 0
            return (summary.id.projectID, count)
        }
    }

    var filteredItems: [MediaItem] {
        visibleItems
    }

    var selectedItems: [MediaItem] {
        visibleItems.filter { selectedIDs.contains($0.id) }
    }

    var primarySelection: MediaItem? {
        if let primarySelectionID,
           let item = visibleItems.first(where: { $0.id == primarySelectionID }) {
            return item
        }
        return selectedItems.first
    }

    var primarySelectionIndex: Int? {
        primarySelectionID.flatMap { selectedID in
            visibleItems.firstIndex(where: { $0.id == selectedID })
        }
    }

    var scrollAnchorID: String? {
        currentScrollAnchorID
    }

    var searchText: String {
        get { query.search ?? "" }
        set { updateQuery { $0.search = newValue.isEmpty ? nil : newValue } }
    }

    var selectedWorkspace: String? {
        get { selectedWorkspaceID }
        set {
            if let newValue {
                enterWorkspace(newValue)
            } else {
                returnToLibrary()
            }
        }
    }

    var selectedProject: String? {
        get { selectedProjectReference?.projectID }
        set {
            guard let workspaceID = selectedWorkspaceID else { return }
            if let newValue,
               let summary = catalog.projects(in: workspaceID).first(
                where: { $0.id.projectID == newValue }
               ) {
                enterProject(summary.id)
            } else {
                enterWorkspace(workspaceID)
            }
        }
    }

    var selectedBucket: MediaBucket? {
        get { query.bucket }
        set { updateQuery { $0.bucket = newValue } }
    }

    var selectedVerdict: ReviewVerdict? {
        get { query.verdict }
        set { updateQuery { $0.verdict = newValue } }
    }

    var favoriteOnly: Bool {
        get { query.favoriteOnly }
        set { updateQuery { $0.favoriteOnly = newValue } }
    }

    var showRejected: Bool {
        get { !query.excludeRejected }
        set { updateQuery { $0.excludeRejected = !newValue } }
    }

    var favoriteCount: Int {
        sourceCounts.favoriteCount
    }

    var isScanning: Bool {
        isLoadingCatalog || isLoadingProject
    }

    var isTrashing: Bool {
        trashProgress != nil
    }

    var hasPendingAnnotationSaves: Bool {
        !pendingAnnotationSaves.isEmpty
    }

    var hasPendingTerminationWork: Bool {
        hasPendingAnnotationSaves || isTrashing
    }

    var selectedSource: LibrarySmartSource {
        switch route {
        case let .workspace(id):
            .workspace(id)
        case let .project(project), let .asset(project, _):
            .project(project.projectID)
        case .library:
            LibrarySourceQuery.selection(for: query)
        }
    }

    func applySource(_ source: LibrarySmartSource) {
        switch source {
        case let .workspace(id):
            enterWorkspace(id)
        case let .project(projectID):
            selectedProject = projectID
        default:
            query = LibrarySourceQuery.applying(source, to: query)
        }
    }

    func count(for verdict: ReviewVerdict) -> Int {
        sourceCounts.count(for: verdict)
    }

    func enterWorkspace(_ id: String) {
        guard catalog.workspaces.contains(where: { $0.id == id }) else { return }
        invalidateProjectLoads()
        var updatedNavigation = navigation
        updatedNavigation.enterWorkspace(id)
        navigation = updatedNavigation
        appSettings.selectedWorkspaceID = id
        appSettings.selectedProjectID = nil
        clearProjectSurface()
    }

    func enterProject(_ project: ProjectReference) {
        guard let root = rootURL,
              catalog.projects(in: project.workspaceID).contains(where: { $0.id == project }) else {
            return
        }
        invalidateProjectLoads()
        var updatedNavigation = navigation
        updatedNavigation.enterProject(project)
        navigation = updatedNavigation
        appSettings.selectedWorkspaceID = project.workspaceID
        appSettings.selectedProjectID = project.projectID

        var projectQuery = query
        projectQuery.workspace = project.workspaceID
        projectQuery.project = project.projectID
        projectQuery.mode = appSettings.projectMode
        query = projectQuery
        clearProjectSurface()
        isLoadingProject = true
        statusText = "Loading \(project.projectID)..."
        enqueueProjectScan(
            project: project,
            root: root,
            attributions: [:],
            startsLedgerHydration: true
        )
    }

    func openAsset(_ item: MediaItem) {
        guard let project = selectedProjectReference,
              item.workspace == project.workspaceID,
              item.project == project.projectID,
              visibleItems.contains(where: { $0.id == item.id }) else {
            return
        }
        let state = ProjectPresentationState(
            mode: query.mode,
            query: query,
            selectedIDs: selectedIDs,
            scrollAnchorID: currentScrollAnchorID
        )
        var updatedNavigation = navigation
        updatedNavigation.setPresentationState(state, for: project)
        if case .asset = updatedNavigation.route {
            updatedNavigation.closeAsset()
        }
        updatedNavigation.openAsset(id: item.id)
        navigation = updatedNavigation
        selectedIDs = [item.id]
        primarySelectionID = item.id
        selectionAnchorID = item.id
    }

    func goBack() {
        switch route {
        case let .asset(project, _):
            guard let state = navigation.presentationState(for: project) else {
                var updatedNavigation = navigation
                updatedNavigation.goBack()
                navigation = updatedNavigation
                return
            }
            query = state.query
            selectedIDs = state.selectedIDs.intersection(Set(items.map(\.id)))
            primarySelectionID = firstSelectedID()
            selectionAnchorID = primarySelectionID
            currentScrollAnchorID = state.scrollAnchorID
            var updatedNavigation = navigation
            updatedNavigation.goBack()
            navigation = updatedNavigation
        case let .project(project):
            enterWorkspace(project.workspaceID)
        case .workspace:
            returnToLibrary()
        case .library:
            break
        }
    }

    func showPreviousAsset() {
        moveAsset(by: -1)
    }

    func showNextAsset() {
        moveAsset(by: 1)
    }

    func updateScrollAnchor(_ id: String?) {
        currentScrollAnchorID = id
    }

    func setProjectMode(_ mode: ProjectMode) {
        appSettings.projectMode = mode
        updateQuery { $0.mode = mode }
    }

    func select(
        _ item: MediaItem,
        command: Bool = false,
        shift: Bool = false
    ) {
        guard let itemIndex = visibleItems.firstIndex(where: { $0.id == item.id }) else { return }

        if shift,
           let selectionAnchorID,
           let anchorIndex = visibleItems.firstIndex(where: { $0.id == selectionAnchorID }) {
            let bounds = min(anchorIndex, itemIndex)...max(anchorIndex, itemIndex)
            let range = Set(bounds.map { visibleItems[$0].id })
            selectedIDs = command ? selectedIDs.union(range) : range
        } else if command {
            if selectedIDs.contains(item.id) {
                selectedIDs.remove(item.id)
            } else {
                selectedIDs.insert(item.id)
            }
            selectionAnchorID = item.id
        } else {
            selectedIDs = [item.id]
            selectionAnchorID = item.id
        }
        primarySelectionID = selectedIDs.contains(item.id) ? item.id : firstSelectedID()
    }

    func select(_ item: MediaItem, additive: Bool) {
        select(item, command: additive)
    }

    func selectAllVisible() {
        selectedIDs = Set(visibleItems.map(\.id))
        primarySelectionID = visibleItems.first?.id
        selectionAnchorID = primarySelectionID
    }

    func clearSelection() {
        selectedIDs = []
        primarySelectionID = nil
        selectionAnchorID = nil
    }

    func selectVisibleItem(at index: Int, extending: Bool = false) {
        guard visibleItems.indices.contains(index) else { return }
        select(visibleItems[index], shift: extending)
    }

    func updateQuery(_ edit: (inout MediaQuery) -> Void) {
        var updated = query
        edit(&updated)
        query = updated
    }

    func requestVisibleItemsUpdate(debounceSearch: Bool = false) {
        queryGeneration &+= 1
        pendingQueryRequest = QueryRequest(
            generation: queryGeneration,
            query: query,
            items: items,
            annotations: annotations,
            debounceSearch: debounceSearch
        )
        isApplyingQuery = true
        scheduleNextQuery()
    }

    func updateSourceCounts() {
        sourceCounts = LibrarySourceCounts(items: items, annotations: annotations)
    }

    func firstSelectedID() -> String? {
        visibleItems.first(where: { selectedIDs.contains($0.id) })?.id
    }

    private func scheduleNextQuery() {
        guard !queryComputationInFlight,
              let request = pendingQueryRequest else { return }
        queryTask?.cancel()
        queryTask = Task { [weak self] in
            if request.debounceSearch {
                do {
                    try await Task.sleep(for: .milliseconds(180))
                } catch {
                    return
                }
            }
            guard !Task.isCancelled else { return }
            await self?.runQuery(request)
        }
    }

    private func runQuery(_ request: QueryRequest) async {
        guard pendingQueryRequest?.generation == request.generation else {
            scheduleNextQuery()
            return
        }
        pendingQueryRequest = nil
        queryTask = nil
        queryComputationInFlight = true
        let evaluator = queryEvaluator
        let sections = await Task.detached(priority: .userInitiated) {
            evaluator(request.query, request.items, request.annotations)
        }.value
        queryComputationInFlight = false

        if request.generation == queryGeneration {
            visibleSections = sections
            visibleItems = sections.flatMap(\.items)
            let visibleIDs = Set(visibleItems.map(\.id))
            selectedIDs.formIntersection(visibleIDs)
            if primarySelectionID.map(selectedIDs.contains) != true {
                primarySelectionID = firstSelectedID()
            }
            if selectionAnchorID.map(visibleIDs.contains) != true {
                selectionAnchorID = primarySelectionID
            }
            isApplyingQuery = false
        }
        if pendingQueryRequest != nil {
            scheduleNextQuery()
        }
    }

    private func moveAsset(by offset: Int) {
        guard case let .asset(project, id) = route,
              let index = visibleItems.firstIndex(where: { $0.id == id }) else {
            return
        }
        let target = index + offset
        guard visibleItems.indices.contains(target) else { return }
        let item = visibleItems[target]
        var updatedNavigation = navigation
        updatedNavigation.closeAsset()
        updatedNavigation.openAsset(id: item.id)
        navigation = updatedNavigation
        selectedIDs = [item.id]
        primarySelectionID = item.id
        selectionAnchorID = item.id
        assert(item.workspace == project.workspaceID && item.project == project.projectID)
    }

    private func returnToLibrary() {
        invalidateProjectLoads()
        var updatedNavigation = navigation
        while updatedNavigation.route != .library {
            updatedNavigation.goBack()
        }
        navigation = updatedNavigation
        appSettings.selectedWorkspaceID = nil
        appSettings.selectedProjectID = nil
        clearProjectSurface()
    }

    func clearProjectSurface() {
        items = []
        visibleSections = []
        visibleItems = []
        selectedIDs = []
        primarySelectionID = nil
        selectionAnchorID = nil
        currentScrollAnchorID = nil
        currentAttributions = [:]
        projectSpendUSD = nil
        isLoadingProject = false
        isLoadingCosts = false
        scanDuration = nil
        updateSourceCounts()
        requestVisibleItemsUpdate()
    }
}
