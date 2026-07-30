import Foundation
import RalphyMediaCore
import Testing
@testable import RalphyMediaApp

@Test @MainActor
func routedChangesRefreshOnlyTheSelectedProjectOrCatalog() async throws {
    let fixture = try LiveSyncFixture()
    defer { fixture.remove() }
    try Data("selected".utf8).write(
        to: fixture.projectURL.appending(path: "selected.mp4")
    )
    let otherProject = fixture.rootURL.appending(
        path: "workspaces/choose-path/projects/other/render"
    )
    try FileManager.default.createDirectory(
        at: otherProject,
        withIntermediateDirectories: true
    )
    let recorder = LiveSyncLoadRecorder()
    let viewModel = LibraryViewModel(
        settings: fixture.settings,
        catalogScan: { root in
            try await recorder.scanCatalog(root: root)
        },
        projectScan: { project, root, options, attributions in
            try await recorder.scanProject(
                project: project,
                root: root,
                options: options,
                attributions: attributions
            )
        }
    )

    viewModel.load(root: fixture.rootURL)
    try await waitUntil {
        !viewModel.isLoadingCatalog
            && !viewModel.isLoadingProject
            && viewModel.items.count == 1
    }
    viewModel.watcher?.stop()
    viewModel.watcher = nil
    try await Task.sleep(for: .milliseconds(650))
    await recorder.reset()

    viewModel.consumeFolderChanges([
        otherProject.appending(path: "other.png").path,
    ])
    try await Task.sleep(for: .milliseconds(650))
    #expect(await recorder.projectCount == 0)

    viewModel.consumeFolderChanges([
        fixture.projectURL.appending(path: "first.png").path,
        fixture.projectURL.appending(path: "second.png").path,
    ])
    try await waitUntilAsync { await recorder.projectCount == 1 }
    try await Task.sleep(for: .milliseconds(650))
    #expect(await recorder.projectCount == 1)

    let newProjectAsset = fixture.rootURL.appending(
        path: "workspaces/choose-path/projects/new-project/render/final.mp4"
    )
    try FileManager.default.createDirectory(
        at: newProjectAsset.deletingLastPathComponent(),
        withIntermediateDirectories: true
    )
    try Data("new".utf8).write(to: newProjectAsset)
    viewModel.consumeFolderChanges([newProjectAsset.path])
    try await waitUntilAsync { await recorder.catalogCount == 1 }
    #expect(await recorder.projectCount == 1)
}

@Test @MainActor
func pendingProjectChangeDoesNotRefreshANewSelection() async throws {
    let fixture = try LiveSyncFixture()
    defer { fixture.remove() }
    let other = ProjectReference(
        workspaceID: fixture.projectReference.workspaceID,
        projectID: "other"
    )
    let otherURL = fixture.rootURL.appending(
        path: "workspaces/\(other.workspaceID)/projects/\(other.projectID)/render"
    )
    try FileManager.default.createDirectory(
        at: otherURL,
        withIntermediateDirectories: true
    )
    try Data("other".utf8).write(to: otherURL.appending(path: "other.mp4"))
    let recorder = LiveSyncLoadRecorder()
    let viewModel = LibraryViewModel(
        settings: fixture.settings,
        projectScan: { project, root, options, attributions in
            try await recorder.scanProject(
                project: project,
                root: root,
                options: options,
                attributions: attributions
            )
        }
    )

    viewModel.load(root: fixture.rootURL)
    try await waitUntil {
        !viewModel.isLoadingCatalog
            && !viewModel.isLoadingProject
            && !viewModel.isLoadingCosts
    }
    viewModel.watcher?.stop()
    viewModel.watcher = nil
    try await Task.sleep(for: .milliseconds(650))
    await recorder.reset()

    viewModel.consumeFolderChanges([
        fixture.projectURL.appending(path: "changed.mp4").path,
    ])
    viewModel.enterProject(other)
    try await waitUntil {
        viewModel.route == .project(other)
            && !viewModel.isLoadingProject
            && !viewModel.isLoadingCosts
    }
    try await Task.sleep(for: .milliseconds(650))

    #expect(await recorder.projectReferences == [other])
}

@Test @MainActor
func liveSyncPreservesSelectionForExistingFilesAndDropsRemovedFiles() async throws {
    let fixture = try LiveSyncFixture()
    defer { fixture.remove() }

    let selectedURL = fixture.projectURL.appending(path: "00-cold.mp4")
    try Data("video".utf8).write(to: selectedURL)

    let viewModel = LibraryViewModel(settings: fixture.settings)
    viewModel.load(root: fixture.rootURL)
    try await waitUntil {
        !viewModel.isScanning
            && !viewModel.isApplyingQuery
            && viewModel.visibleItems.count == 1
    }

    let selected = try #require(viewModel.visibleItems.first)
    viewModel.select(selected)
    #expect(viewModel.selectedIDs == [selected.id])
    #expect(viewModel.primarySelection?.id == selected.id)

    let addedURL = fixture.projectURL.appending(path: "new.png")
    try Data("image".utf8).write(to: addedURL)
    viewModel.consumeFolderChanges([addedURL.path])
    try await waitUntil {
        !viewModel.isScanning
            && !viewModel.isApplyingQuery
            && viewModel.visibleItems.count == 2
    }

    #expect(viewModel.selectedIDs == [selected.id])
    #expect(viewModel.primarySelection?.id == selected.id)

    let added = try #require(
        viewModel.items.first(where: { $0.url.lastPathComponent == "new.png" })
    )
    viewModel.select(added, shift: true)
    #expect(viewModel.selectedIDs == [selected.id, added.id])
    #expect(viewModel.primarySelection?.id == added.id)

    viewModel.select(selected)
    try FileManager.default.removeItem(at: selectedURL)
    viewModel.consumeFolderChanges([selectedURL.path])
    try await waitUntil {
        !viewModel.isScanning
            && !viewModel.isApplyingQuery
            && viewModel.visibleItems.count == 1
    }

    #expect(viewModel.selectedIDs.isEmpty)
    #expect(viewModel.primarySelection == nil)
}

@MainActor
private func waitUntil(
    timeout: Duration = .seconds(8),
    condition: @escaping @MainActor () -> Bool
) async throws {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: timeout)
    while !condition() {
        guard clock.now < deadline else {
            throw LiveSyncTestError.timedOut
        }
        try await Task.sleep(for: .milliseconds(50))
    }
}

private func waitUntilAsync(
    timeout: Duration = .seconds(8),
    condition: @escaping @Sendable () async -> Bool
) async throws {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: timeout)
    while !(await condition()) {
        guard clock.now < deadline else {
            throw LiveSyncTestError.timedOut
        }
        try await Task.sleep(for: .milliseconds(20))
    }
}

private enum LiveSyncTestError: Error {
    case timedOut
}

private actor LiveSyncLoadRecorder {
    private(set) var catalogCount = 0
    private(set) var projectCount = 0
    private(set) var projectReferences: [ProjectReference] = []

    func scanCatalog(root: URL) throws -> WorkspaceCatalogSnapshot {
        catalogCount += 1
        return try WorkspaceCatalogScanner().scan(root: root)
    }

    func scanProject(
        project: ProjectReference,
        root: URL,
        options: ScanOptions,
        attributions: [String: GenerationAttribution]
    ) throws -> ScanResult {
        projectCount += 1
        projectReferences.append(project)
        return try MediaScanner().scan(
            project: project,
            root: root,
            options: options,
            attributions: attributions
        )
    }

    func reset() {
        catalogCount = 0
        projectCount = 0
        projectReferences = []
    }
}

private struct LiveSyncFixture {
    let containerURL: URL
    let rootURL: URL
    let projectURL: URL
    let defaultsSuite: String
    let settings: AppSettings

    var projectReference: ProjectReference {
        ProjectReference(
            workspaceID: "choose-path",
            projectID: "rip-oliver-tree"
        )
    }

    init() throws {
        containerURL = FileManager.default.temporaryDirectory
            .appending(path: "RalphyMedia-\(UUID().uuidString)")
        rootURL = containerURL.appending(path: ".ralphy")
        projectURL = rootURL.appending(
            path: "workspaces/choose-path/projects/rip-oliver-tree/render/parts2"
        )
        defaultsSuite = "app.ralphy.media.tests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: defaultsSuite))
        defaults.removePersistentDomain(forName: defaultsSuite)
        settings = AppSettings(defaults: defaults)
        try FileManager.default.createDirectory(
            at: projectURL,
            withIntermediateDirectories: true
        )
        settings.selectedWorkspaceID = projectReference.workspaceID
        settings.selectedProjectID = projectReference.projectID
    }

    func remove() {
        try? FileManager.default.removeItem(at: containerURL)
        UserDefaults.standard.removePersistentDomain(forName: defaultsSuite)
    }
}
