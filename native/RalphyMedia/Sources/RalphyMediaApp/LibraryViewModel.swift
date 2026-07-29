import AppKit
import Foundation
import RalphyMediaCore

@MainActor
final class LibraryViewModel: ObservableObject {
    @Published private(set) var rootURL: URL?
    @Published private(set) var items: [MediaItem] = []
    @Published private(set) var annotations: [String: MediaAnnotation] = [:]
    @Published private(set) var visibleSections: [MediaSection] = []
    @Published private(set) var visibleItems: [MediaItem] = []
    @Published private(set) var selectedIDs: Set<String> = []
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

    var workspaces: [(String, Int)] {
        counted(items.map(\.workspace))
    }

    var projects: [(String, Int)] {
        let source = query.workspace.map { workspace in
            items.filter { $0.workspace == workspace }
        } ?? items
        return counted(source.map(\.project))
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

    var favoriteOnly: Bool {
        get { query.favoriteOnly }
        set { updateQuery { $0.favoriteOnly = newValue } }
    }

    var showRejected: Bool {
        get { !query.excludeRejected }
        set { updateQuery { $0.excludeRejected = !newValue } }
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
        for item in targets {
            var annotation = annotation(for: item)
            edit(&annotation)
            annotation.updatedAt = updatedAt
            annotations[item.relativePath] = annotation
        }
        if desiredContext?.root == rootURL {
            desiredContext?.annotations = annotations
        }
        updateVisibleItems()
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
            Task { @MainActor in
                guard self?.desiredContext?.root == root else { return }
                self?.requestScan()
            }
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

    private func counted(_ values: [String]) -> [(String, Int)] {
        Dictionary(grouping: values, by: { $0 })
            .map { ($0.key, $0.value.count) }
            .sorted { $0.0.localizedStandardCompare($1.0) == .orderedAscending }
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
