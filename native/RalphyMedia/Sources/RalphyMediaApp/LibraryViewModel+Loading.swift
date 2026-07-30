import AppKit
import Foundation
import RalphyMediaCore

extension LibraryViewModel {
    func restoreLastLibrary() {
        guard rootURL == nil, let root = appSettings.lastRoot else { return }
        load(root: root)
    }

    func pickLibrary() {
        guard !isTerminating else {
            if isTrashing {
                errorMessage = "Wait for the Trash operation to finish before changing libraries."
            }
            return
        }
        guard !isTrashing else {
            errorMessage = "Wait for the Trash operation to finish before changing libraries."
            return
        }
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
        guard !isTerminating else {
            if isTrashing {
                errorMessage = "Wait for the Trash operation to finish before changing libraries."
            }
            return
        }
        guard !isTrashing else {
            errorMessage = "Wait for the Trash operation to finish before changing libraries."
            return
        }
        let root = root.standardizedFileURL
        var isDirectory: ObjCBool = false
        let workspacesURL = root.appending(path: "workspaces")
        guard root.lastPathComponent == ".ralphy",
              FileManager.default.fileExists(
                atPath: workspacesURL.path,
                isDirectory: &isDirectory
              ),
              isDirectory.boolValue else {
            errorMessage = "Choose a .ralphy folder that contains a workspaces directory."
            return
        }

        rootLoadGeneration &+= 1
        let generation = rootLoadGeneration
        if pendingAnnotationSaves[root] != nil {
            Task { [weak self] in
                guard let self else { return }
                let outcome = await self.flushPendingAnnotationSave(for: root)
                guard generation == self.rootLoadGeneration,
                      !self.isTrashing,
                      !self.isTerminating else {
                    return
                }
                switch outcome {
                case .saved:
                    self.openValidatedRoot(root, rootGeneration: generation)
                case .reloadRequired:
                    self.cancelPendingSave(for: root)
                    self.openValidatedRoot(root, rootGeneration: generation)
                case .retryableFailure:
                    break
                }
            }
            return
        }
        openValidatedRoot(root, rootGeneration: generation)
    }

    func consumeFolderChanges(_ paths: [String]) {
        guard let root = rootURL,
              desiredContext?.root == root,
              !isTerminating,
              !isTrashing else {
            return
        }
        let changes = FolderChangeRouter.route(paths: paths, root: root)
        let containsUnknownProject = changes.projects.contains { project in
            !catalog.projects(in: project.workspaceID).contains { $0.id == project }
        }
        if changes.catalogStructureChanged || containsUnknownProject {
            Task { await catalogReloadCoalescer.request() }
        }
        if let project = selectedProjectReference,
           changes.projects.contains(project) {
            requestSelectedProjectRefresh()
        }
    }

    func requestSelectedProjectRefresh() {
        guard let project = selectedProjectReference,
              let root = rootURL else {
            return
        }
        pendingProjectRefreshTarget = ProjectRefreshTarget(
            project: project,
            root: root
        )
        Task { await projectReloadCoalescer.request() }
    }

    func refreshCatalog() async {
        guard let context = desiredContext,
              context.root == rootURL,
              !isTerminating,
              !isTrashing else {
            return
        }
        startCatalogScan(
            context: context,
            rootGeneration: rootLoadGeneration,
            restoreSelection: false
        )
    }

    func refreshRequestedProject() async {
        guard let target = pendingProjectRefreshTarget else { return }
        pendingProjectRefreshTarget = nil
        guard selectedProjectReference == target.project,
              rootURL == target.root,
              !isTerminating,
              !isTrashing else {
            return
        }
        ledgerGeneration &+= 1
        ledgerTask?.cancel()
        enqueueProjectScan(
            project: target.project,
            root: target.root,
            attributions: currentAttributions,
            startsLedgerHydration: true
        )
    }

    func invalidateProjectLoads() {
        projectGeneration &+= 1
        ledgerGeneration &+= 1
        projectTask?.cancel()
        projectTask = nil
        ledgerTask?.cancel()
        ledgerTask = nil
        pendingProjectRequest = nil
        pendingProjectRefreshTarget = nil
        activeProjectGeneration = nil
        projectComputationInFlight = false
        currentAttributions = [:]
        projectLoadingState = false
        costsLoadingState = false
    }

    func enqueueProjectScan(
        project: ProjectReference,
        root: URL,
        attributions: [String: GenerationAttribution],
        startsLedgerHydration: Bool
    ) {
        projectGeneration &+= 1
        pendingProjectRequest = ProjectScanRequest(
            generation: projectGeneration,
            project: project,
            root: root,
            options: ScanOptions(includeIntermediates: includeIntermediates),
            attributions: attributions,
            startsLedgerHydration: startsLedgerHydration
        )
        projectLoadingState = true
        scheduleNextProjectScan()
    }

    private func openValidatedRoot(
        _ root: URL,
        rootGeneration: UInt64
    ) {
        guard rootGeneration == rootLoadGeneration,
              !isTrashing,
              !isTerminating else {
            return
        }
        let context: LibraryContext
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
            let metadataURL = root.appending(path: "media-library/library.json")
            let warning = "Could not read \(metadataURL.path). " +
                "Media will remain visible, but annotation changes will not be saved: " +
                error.localizedDescription
            context = LibraryContext(
                root: root,
                annotations: [:],
                store: nil,
                metadataWarning: warning
            )
            errorMessage = warning
        }

        desiredContext = context
        startWatching(root: root)
        invalidateProjectLoads()
        catalogState = .empty
        rootURL = nil
        navigationState = WorkbenchNavigation()
        clearProjectSurface()
        startCatalogScan(
            context: context,
            rootGeneration: rootGeneration,
            restoreSelection: true
        )
    }

    private func startCatalogScan(
        context: LibraryContext,
        rootGeneration: UInt64,
        restoreSelection: Bool
    ) {
        catalogGeneration &+= 1
        let generation = catalogGeneration
        catalogTask?.cancel()
        catalogLoadingState = true
        statusText = "Loading workspaces..."
        let operation = catalogScan

        catalogTask = Task { [weak self] in
            do {
                let snapshot = try await operation(context.root)
                self?.acceptCatalog(
                    snapshot,
                    context: context,
                    generation: generation,
                    rootGeneration: rootGeneration,
                    restoreSelection: restoreSelection
                )
            } catch {
                self?.rejectCatalog(
                    error,
                    context: context,
                    generation: generation,
                    rootGeneration: rootGeneration
                )
            }
        }
    }

    private func acceptCatalog(
        _ snapshot: WorkspaceCatalogSnapshot,
        context: LibraryContext,
        generation: UInt64,
        rootGeneration: UInt64,
        restoreSelection: Bool
    ) {
        guard generation == catalogGeneration,
              rootGeneration == rootLoadGeneration,
              let activeContext = desiredContext,
              activeContext.root == context.root,
              !isTerminating,
              !isTrashing else {
            return
        }
        catalogTask = nil
        catalogState = snapshot
        rootURL = context.root
        annotations = activeContext.annotations
        store = activeContext.store
        catalogLoadingState = false
        appSettings.lastRoot = context.root
        statusText = "\(snapshot.workspaces.count) workspaces"
        if let warning = activeContext.metadataWarning {
            errorMessage = warning
        }

        if restoreSelection {
            restoreSavedSelection()
        } else {
            reconcileNavigationWithCatalog()
        }
    }

    private func rejectCatalog(
        _ error: Error,
        context: LibraryContext,
        generation: UInt64,
        rootGeneration: UInt64
    ) {
        guard generation == catalogGeneration,
              rootGeneration == rootLoadGeneration,
              desiredContext?.root == context.root else {
            return
        }
        catalogTask = nil
        catalogLoadingState = false
        statusText = "Could not load workspaces."
        errorMessage = "Could not scan \(context.root.path): \(error.localizedDescription)"
    }

    private func restoreSavedSelection() {
        navigationState = WorkbenchNavigation()
        guard let workspaceID = appSettings.selectedWorkspaceID,
              catalog.workspaces.contains(where: { $0.id == workspaceID }) else {
            appSettings.selectedWorkspaceID = nil
            appSettings.selectedProjectID = nil
            return
        }
        guard let projectID = appSettings.selectedProjectID,
              let project = catalog.projects(in: workspaceID).first(
                where: { $0.id.projectID == projectID }
              )?.id else {
            appSettings.selectedProjectID = nil
            enterWorkspace(workspaceID)
            return
        }
        enterProject(project)
    }

    private func reconcileNavigationWithCatalog() {
        if let project = selectedProjectReference {
            if catalog.projects(in: project.workspaceID).contains(where: { $0.id == project }) {
                return
            }
            if catalog.workspaces.contains(where: { $0.id == project.workspaceID }) {
                enterWorkspace(project.workspaceID)
            } else {
                returnToCatalogLibrary()
            }
            return
        }
        if let workspaceID = selectedWorkspaceID,
           !catalog.workspaces.contains(where: { $0.id == workspaceID }) {
            returnToCatalogLibrary()
        }
    }

    private func returnToCatalogLibrary() {
        invalidateProjectLoads()
        navigationState = WorkbenchNavigation()
        appSettings.selectedWorkspaceID = nil
        appSettings.selectedProjectID = nil
        clearProjectSurface()
    }

    private func scheduleNextProjectScan() {
        guard !projectComputationInFlight,
              let request = pendingProjectRequest else {
            return
        }
        pendingProjectRequest = nil
        projectComputationInFlight = true
        activeProjectGeneration = request.generation
        let operation = projectScan
        let startedAt = Date()
        projectTask = Task { [weak self] in
            do {
                let result = try await operation(
                    request.project,
                    request.root,
                    request.options,
                    request.attributions
                )
                self?.finishProjectScan(
                    request,
                    startedAt: startedAt,
                    result: .success(result)
                )
            } catch {
                self?.finishProjectScan(
                    request,
                    startedAt: startedAt,
                    result: .failure(error)
                )
            }
        }
    }

    private func finishProjectScan(
        _ request: ProjectScanRequest,
        startedAt: Date,
        result: Result<ScanResult, Error>
    ) {
        let ownsActiveSlot = activeProjectGeneration == request.generation
        if ownsActiveSlot {
            activeProjectGeneration = nil
            projectComputationInFlight = false
            projectTask = nil
        }
        defer {
            if ownsActiveSlot, pendingProjectRequest != nil {
                scheduleNextProjectScan()
            }
        }

        guard request.generation == projectGeneration,
              selectedProjectReference == request.project,
              rootURL == request.root,
              !isTerminating,
              !isTrashing else {
            return
        }

        switch result {
        case let .success(scan):
            let duration = Date().timeIntervalSince(startedAt)
            projectItemsState = scan.items
            selectionState.formIntersection(Set(items.map(\.id)))
            if primarySelectionID.map(selectedIDs.contains) != true {
                primarySelectionID = firstSelectedID()
            }
            if selectionAnchorID.map({ id in items.contains(where: { $0.id == id }) }) != true {
                selectionAnchorID = primarySelectionID
            }
            scanDuration = duration
            projectLoadingState = false
            statusText = scanStatus(
                count: scan.items.count,
                skipped: scan.skipped,
                duration: duration
            )
            updateSourceCounts()
            requestVisibleItemsUpdate()
            if request.startsLedgerHydration {
                startLedgerHydration(project: request.project, root: request.root)
            }
        case let .failure(error):
            projectLoadingState = false
            statusText = "Project scan failed."
            errorMessage = "Could not scan \(request.project.projectID): \(error.localizedDescription)"
        }
    }

    private func startLedgerHydration(
        project: ProjectReference,
        root: URL
    ) {
        ledgerGeneration &+= 1
        let generation = ledgerGeneration
        ledgerTask?.cancel()
        costsLoadingState = true
        let operation = ledgerLoad
        ledgerTask = Task { [weak self] in
            let summary = await operation(project, root)
            self?.acceptLedger(
                summary,
                project: project,
                root: root,
                generation: generation
            )
        }
    }

    private func acceptLedger(
        _ summary: GenerationLedgerSummary,
        project: ProjectReference,
        root: URL,
        generation: UInt64
    ) {
        guard generation == ledgerGeneration,
              selectedProjectReference == project,
              rootURL == root,
              !isTerminating,
              !isTrashing else {
            return
        }
        ledgerTask = nil
        costsLoadingState = false
        spendState = summary.totalSpendUSD
        guard summary.attributions != currentAttributions else { return }
        currentAttributions = summary.attributions
        enqueueProjectScan(
            project: project,
            root: root,
            attributions: summary.attributions,
            startsLedgerHydration: false
        )
    }

    private func startWatching(root: URL) {
        watcher?.stop()
        watcher = FolderWatcher(root: root) { [weak self] paths in
            guard self?.desiredContext?.root == root else { return }
            self?.consumeFolderChanges(paths)
        }
        watcher?.start()
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
