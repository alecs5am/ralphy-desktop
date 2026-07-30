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
        updated.workspace = nil
        updated.project = nil
        updated.verdict = nil
        updated.favoriteOnly = false
        updated.excludeRejected = false

        switch source {
        case .all:
            break
        case .usable:
            updated.excludeRejected = true
        case let .verdict(verdict):
            updated.verdict = verdict
        case .favorites:
            updated.favoriteOnly = true
        case let .workspace(workspace):
            updated.workspace = workspace
        case let .project(project):
            updated.workspace = query.workspace
            updated.project = project
        }
        return updated
    }

    static func selection(for query: MediaQuery) -> LibrarySmartSource {
        if let project = query.project {
            return .project(project)
        }
        if let workspace = query.workspace {
            return .workspace(workspace)
        }
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

@MainActor
final class LibraryViewModel: ObservableObject {
    @Published private(set) var rootURL: URL?
    @Published private(set) var items: [MediaItem] = []
    @Published private(set) var annotations: [String: MediaAnnotation] = [:]
    @Published private(set) var visibleSections: [MediaSection] = []
    @Published private(set) var visibleItems: [MediaItem] = []
    @Published private(set) var selectedIDs: Set<String> = []
    @Published private(set) var sourceCounts = LibrarySourceCounts()
    @Published private(set) var isScanning = false
    @Published private(set) var scanDuration: TimeInterval?
    @Published private(set) var statusText = "Open a .ralphy folder"
    @Published private(set) var pendingTrashConfirmation: [MediaItem]?
    @Published private(set) var quickLookURL: URL?
    @Published var errorMessage: String?

    @Published var query: MediaQuery {
        didSet {
            appSettings.bucket = query.bucket
            appSettings.sort = query.sort
            appSettings.group = query.group
            updateVisibleItems()
        }
    }

    @Published var gridSize: Double {
        didSet { appSettings.gridSize = gridSize }
    }

    @Published var includeIntermediates: Bool {
        didSet {
            guard includeIntermediates != oldValue else { return }
            appSettings.includeIntermediates = includeIntermediates
            requestScan()
        }
    }

    @Published var inspectorVisible: Bool {
        didSet { appSettings.inspectorVisible = inspectorVisible }
    }

    private struct LibraryContext {
        let root: URL
        var annotations: [String: MediaAnnotation]
        var store: MetadataStore?
        let metadataWarning: String?
    }

    private struct ScanRequest {
        let generation: UInt64
        let context: LibraryContext
        let options: ScanOptions
    }

    private let appSettings: AppSettings
    private let metadataSaveCoordinator = MetadataSaveCoordinator()
    private var desiredContext: LibraryContext?
    private var requestedScan: ScanRequest?
    private var store: MetadataStore?
    private var watcher: FolderWatcher?
    private var scanGeneration: UInt64 = 0
    private var selectionAnchorID: String?
    private var primarySelectionID: String?
    private var metadataSaveTasks: [URL: Task<Void, Never>] = [:]

    private lazy var reloadCoalescer = ReloadCoalescer(delay: .milliseconds(450)) { [weak self] in
        await self?.performRequestedScan()
    }

    init(settings: AppSettings = AppSettings()) {
        appSettings = settings
        query = MediaQuery(
            bucket: settings.bucket,
            sort: settings.sort,
            group: settings.group
        )
        gridSize = settings.gridSize
        includeIntermediates = settings.includeIntermediates
        inspectorVisible = settings.inspectorVisible
        updateVisibleItems()
    }

    var filteredItems: [MediaItem] {
        visibleItems
    }

    var selectedItems: [MediaItem] {
        let visible = visibleItems.filter { selectedIDs.contains($0.id) }
        let visibleIDs = Set(visible.map(\.id))
        return visible + items.filter {
            selectedIDs.contains($0.id) && !visibleIDs.contains($0.id)
        }
    }

    var primarySelection: MediaItem? {
        if let primarySelectionID,
           let item = items.first(where: { $0.id == primarySelectionID }) {
            return item
        }
        return selectedItems.first
    }

    var primarySelectionIndex: Int? {
        primarySelectionID.flatMap { selectedID in
            visibleItems.firstIndex(where: { $0.id == selectedID })
        }
    }

    var workspaces: [(String, Int)] {
        sourceCounts.workspaces
    }

    var projects: [(String, Int)] {
        sourceCounts.projects(in: query.workspace)
    }

    var searchText: String {
        get { query.search ?? "" }
        set { updateQuery { $0.search = newValue.isEmpty ? nil : newValue } }
    }

    var selectedWorkspace: String? {
        get { query.workspace }
        set { updateQuery { $0.workspace = newValue } }
    }

    var selectedProject: String? {
        get { query.project }
        set { updateQuery { $0.project = newValue } }
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

    func count(for verdict: ReviewVerdict) -> Int {
        sourceCounts.count(for: verdict)
    }

    var selectedSource: LibrarySmartSource {
        LibrarySourceQuery.selection(for: query)
    }

    func applySource(_ source: LibrarySmartSource) {
        query = LibrarySourceQuery.applying(source, to: query)
    }

    func restoreLastLibrary() {
        guard let root = appSettings.lastRoot else { return }
        load(root: root)
    }

    func pickLibrary() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.showsHiddenFiles = true
        panel.prompt = "Open .ralphy"
        panel.directoryURL = appSettings.lastRoot?.deletingLastPathComponent()
        if panel.runModal() == .OK, let url = panel.url {
            load(root: url)
        }
    }

    func load(root: URL) {
        let root = root.standardizedFileURL
        var isDirectory: ObjCBool = false
        let workspaces = root.appending(path: "workspaces")
        guard root.lastPathComponent == ".ralphy",
              FileManager.default.fileExists(atPath: workspaces.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            errorMessage = "Choose a .ralphy folder that contains a workspaces directory."
            return
        }

        let context: LibraryContext
        if root == rootURL {
            context = LibraryContext(
                root: root,
                annotations: annotations,
                store: store,
                metadataWarning: desiredContext?.metadataWarning
            )
        } else {
            do {
                let metadata = try MetadataStore(root: root)
                context = LibraryContext(
                    root: root,
                    annotations: metadata.annotations,
                    store: metadata,
                    metadataWarning: nil
                )
                errorMessage = nil
            } catch {
                let warning = "Could not read \(root.appending(path: "media-library/library.json").path). " +
                    "Media will remain visible, but annotation changes will not be saved: \(error.localizedDescription)"
                context = LibraryContext(
                    root: root,
                    annotations: [:],
                    store: nil,
                    metadataWarning: warning
                )
                errorMessage = warning
            }
        }

        desiredContext = context
        startWatching(root: root)
        requestScan()
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

    func annotation(for item: MediaItem) -> MediaAnnotation {
        annotations[item.relativePath] ?? MediaAnnotation()
    }

    func updateAnnotation(
        for item: MediaItem,
        _ edit: (inout MediaAnnotation) -> Void
    ) {
        mutateAnnotations(for: [item], edit)
    }

    func setVerdict(_ verdict: ReviewVerdict) {
        mutateAnnotations(for: selectedItems) { $0.verdict = verdict }
    }

    func setRating(_ rating: Int) {
        mutateAnnotations(for: selectedItems) { $0.rating = rating }
    }

    func setFavorite(_ favorite: Bool) {
        mutateAnnotations(for: selectedItems) { $0.favorite = favorite }
    }

    func toggleFavorite() {
        let selected = selectedItems
        let allFavorites = !selected.isEmpty && selected.allSatisfy { annotation(for: $0).favorite }
        mutateAnnotations(for: selected) { $0.favorite = !allFavorites }
    }

    func addTags(_ tags: [String]) {
        mutateAnnotations(for: selectedItems) { $0.tags += tags }
    }

    func removeTags(_ tags: [String]) {
        let removed = Set(tags.map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        })
        mutateAnnotations(for: selectedItems) {
            $0.tags.removeAll { removed.contains($0.lowercased()) }
        }
    }

    func setNote(_ note: String) {
        mutateAnnotations(for: selectedItems) { $0.note = note }
    }

    func showQuickLook() {
        quickLookURL = primarySelection?.url
    }

    func clearQuickLook() {
        quickLookURL = nil
    }

    func copyPaths() {
        let text = selectedItems.map(\.url.path).joined(separator: "\n")
        guard !text.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    func copyForAgent() {
        let selected = selectedItems
        guard !selected.isEmpty else { return }
        let text = AgentFeedback.render(items: selected, annotations: annotations)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    func openSelection() {
        for item in selectedItems {
            NSWorkspace.shared.open(item.url)
        }
    }

    func revealSelectionInFinder() {
        let urls = selectedItems.map(\.url)
        guard !urls.isEmpty else { return }
        NSWorkspace.shared.activateFileViewerSelecting(urls)
    }

    func requestTrash() {
        let selected = selectedItems
        guard !selected.isEmpty else { return }
        pendingTrashConfirmation = selected
    }

    func confirmTrash() {
        guard let pending = pendingTrashConfirmation else { return }
        pendingTrashConfirmation = nil

        var trashedIDs = Set<String>()
        var failures: [String] = []
        for item in pending {
            do {
                var resultingURL: NSURL?
                try FileManager.default.trashItem(at: item.url, resultingItemURL: &resultingURL)
                trashedIDs.insert(item.id)
            } catch {
                failures.append("\(item.filename): \(error.localizedDescription)")
            }
        }

        if !trashedIDs.isEmpty {
            items.removeAll { trashedIDs.contains($0.id) }
            selectedIDs.subtract(trashedIDs)
            if primarySelectionID.map(trashedIDs.contains) == true {
                primarySelectionID = firstSelectedID()
            }
            updateSourceCounts()
            updateVisibleItems()
            requestScan()
        }
        if !failures.isEmpty {
            errorMessage = "Could not move files to Trash:\n" + failures.joined(separator: "\n")
        }
    }

    func cancelTrash() {
        pendingTrashConfirmation = nil
    }

    func moveSelectionToTrash() {
        requestTrash()
    }

    private func updateQuery(_ edit: (inout MediaQuery) -> Void) {
        var updated = query
        edit(&updated)
        query = updated
    }

    private func mutateAnnotations(
        for targets: [MediaItem],
        _ edit: (inout MediaAnnotation) -> Void
    ) {
        guard !targets.isEmpty else { return }
        let updatedAt = Date()
        var updatedAnnotations = annotations
        var verdictChanged = false
        var favoriteChanged = false
        var searchMetadataChanged = false

        for item in targets {
            var annotation = annotation(for: item)
            let previous = annotation
            edit(&annotation)
            annotation.updatedAt = updatedAt
            updatedAnnotations[item.relativePath] = annotation
            verdictChanged = verdictChanged || previous.verdict != annotation.verdict
            favoriteChanged = favoriteChanged || previous.favorite != annotation.favorite
            searchMetadataChanged = searchMetadataChanged
                || previous.tags != annotation.tags
                || previous.note != annotation.note
        }
        annotations = updatedAnnotations
        if desiredContext?.root == rootURL {
            desiredContext?.annotations = annotations
        }
        if verdictChanged || favoriteChanged {
            updateSourceCounts()
        }
        let searchActive = !(query.search?.isEmpty ?? true)
        if verdictChanged && (query.verdict != nil || query.excludeRejected)
            || favoriteChanged && query.favoriteOnly
            || searchMetadataChanged && searchActive {
            updateVisibleItems()
        }
        saveAnnotations()
    }

    private func saveAnnotations() {
        guard let store else {
            if let warning = desiredContext?.metadataWarning {
                errorMessage = warning
            }
            return
        }

        let snapshot = annotations
        let root = store.root
        let coordinator = metadataSaveCoordinator
        metadataSaveTasks[root]?.cancel()
        metadataSaveTasks[root] = Task { [weak self, store] in
            do {
                try await Task.sleep(for: .milliseconds(350))
                try Task.checkCancellation()
                var updatedStore = store
                updatedStore.annotations = snapshot
                let save = await coordinator.submit(updatedStore)
                let savedStore = try await save.value
                self?.metadataSaveCompleted(savedStore)
            } catch is CancellationError {
                return
            } catch {
                self?.errorMessage = "Annotations were not saved. \(error.localizedDescription)"
            }
        }
    }

    private func requestScan() {
        guard let context = desiredContext else { return }
        scanGeneration &+= 1
        requestedScan = ScanRequest(
            generation: scanGeneration,
            context: context,
            options: ScanOptions(includeIntermediates: includeIntermediates)
        )
        isScanning = true
        statusText = "Scanning \(context.root.path)..."
        Task {
            await reloadCoalescer.request()
        }
    }

    private func performRequestedScan() async {
        guard let request = requestedScan else { return }
        let startedAt = Date()
        if request.generation == scanGeneration {
            isScanning = true
            statusText = "Scanning \(request.context.root.path)..."
        }

        do {
            let result = try await Task.detached(priority: .userInitiated) {
                try MediaScanner().scan(root: request.context.root, options: request.options)
            }.value
            let duration = Date().timeIntervalSince(startedAt)

            guard request.generation == scanGeneration,
                  let latestContext = desiredContext,
                  latestContext.root == request.context.root else { return }
            rootURL = latestContext.root
            items = result.items
            annotations = latestContext.annotations
            updateSourceCounts()
            store = latestContext.store
            selectedIDs.formIntersection(Set(items.map(\.id)))
            if primarySelectionID.map(selectedIDs.contains) != true {
                primarySelectionID = firstSelectedID()
            }
            if selectionAnchorID.map({ anchorID in items.contains(where: { $0.id == anchorID }) }) == false {
                selectionAnchorID = primarySelectionID
            }
            scanDuration = duration
            isScanning = false
            statusText = scanStatus(
                count: result.items.count,
                skipped: result.skipped,
                duration: duration
            )
            appSettings.lastRoot = latestContext.root
            if let warning = latestContext.metadataWarning {
                errorMessage = warning
            }
            updateVisibleItems()
        } catch {
            guard request.generation == scanGeneration else { return }
            scanDuration = Date().timeIntervalSince(startedAt)
            isScanning = false
            statusText = "Scan failed. Showing the last successful library."
            errorMessage = "Could not scan \(request.context.root.path): \(error.localizedDescription)"
        }
    }

    private func startWatching(root: URL) {
        watcher?.stop()
        watcher = FolderWatcher(root: root) { [weak self] in
            guard self?.desiredContext?.root == root else { return }
            self?.requestScan()
        }
        watcher?.start()
    }

    private func metadataSaveCompleted(_ savedStore: MetadataStore) {
        guard rootURL == savedStore.root else { return }
        store = savedStore
        if desiredContext?.root == savedStore.root {
            desiredContext?.store = savedStore
        }
    }

    private func updateVisibleItems() {
        visibleSections = query.sections(from: items, annotations: annotations)
        visibleItems = visibleSections.flatMap(\.items)
    }

    private func updateSourceCounts() {
        sourceCounts = LibrarySourceCounts(
            items: items,
            annotations: annotations
        )
    }

    private func firstSelectedID() -> String? {
        visibleItems.first(where: { selectedIDs.contains($0.id) })?.id
            ?? items.first(where: { selectedIDs.contains($0.id) })?.id
    }

    private func scanStatus(
        count: Int,
        skipped: Int,
        duration: TimeInterval
    ) -> String {
        let timing = duration.formatted(.number.precision(.fractionLength(2)))
        let skippedText = skipped == 0 ? "" : " (\(skipped) skipped)"
        return "Indexed \(count) files\(skippedText) in \(timing)s"
    }
}
