import Foundation
import Testing
@testable import RalphyMediaApp

@Test @MainActor
func liveSyncPreservesSelectionForExistingFilesAndDropsRemovedFiles() async throws {
    let fixture = try LiveSyncFixture()
    defer { fixture.remove() }

    let selectedURL = fixture.projectURL.appending(path: "00-cold.mp4")
    try Data("video".utf8).write(to: selectedURL)

    let viewModel = LibraryViewModel(settings: fixture.settings)
    viewModel.load(root: fixture.rootURL)
    try await waitUntil {
        !viewModel.isScanning && viewModel.items.count == 1
    }

    let selected = try #require(viewModel.items.first)
    viewModel.select(selected)
    #expect(viewModel.selectedIDs == [selected.id])
    #expect(viewModel.primarySelection?.id == selected.id)

    try Data("image".utf8).write(
        to: fixture.projectURL.appending(path: "new.png")
    )
    try await waitUntil {
        !viewModel.isScanning && viewModel.items.count == 2
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
    try await waitUntil {
        !viewModel.isScanning && viewModel.items.count == 1
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

private enum LiveSyncTestError: Error {
    case timedOut
}

private struct LiveSyncFixture {
    let containerURL: URL
    let rootURL: URL
    let projectURL: URL
    let defaultsSuite: String
    let settings: AppSettings

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
    }

    func remove() {
        try? FileManager.default.removeItem(at: containerURL)
        UserDefaults.standard.removePersistentDomain(forName: defaultsSuite)
    }
}
