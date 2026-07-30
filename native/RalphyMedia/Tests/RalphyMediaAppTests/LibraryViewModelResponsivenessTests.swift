import AppKit
import Foundation
import RalphyMediaCore
import Testing
@testable import RalphyMediaApp

@Test @MainActor
func queryPipelineRunsOffMainAndDiscardsStaleResults() async throws {
    let fixture = try ResponsiveLibraryFixture(filenames: ["fast.mp4", "slow.mp4"])
    defer { fixture.remove() }
    let evaluator = BlockingQueryEvaluator()
    let viewModel = LibraryViewModel(
        settings: fixture.settings,
        queryEvaluator: evaluator.evaluate
    )

    viewModel.load(root: fixture.rootURL)
    try await waitUntil {
        !viewModel.isScanning && viewModel.visibleItems.count == 2
    }
    evaluator.resetHistory()

    viewModel.searchText = "slow"
    try await waitUntil { evaluator.slowQueryStarted }

    viewModel.searchText = "discard-me"
    viewModel.searchText = "fast"
    try await Task.sleep(for: .milliseconds(100))
    #expect(evaluator.startedQueries == ["slow"])
    #expect(evaluator.maximumConcurrentQueries == 1)

    evaluator.releaseSlowQuery()
    try await waitUntil {
        viewModel.visibleItems.map(\.filename) == ["fast.mp4"]
    }

    #expect(viewModel.visibleItems.map(\.filename) == ["fast.mp4"])
    #expect(!evaluator.ranOnMainThread)
    #expect(evaluator.startedQueries == ["slow", "fast"])
    #expect(evaluator.maximumConcurrentQueries == 1)
}

@Test @MainActor
func reviewActionDuringQueryAppliesToCurrentSelection() async throws {
    let fixture = try ResponsiveLibraryFixture(filenames: ["keep.mp4", "slow.mp4"])
    defer { fixture.remove() }
    let evaluator = BlockingQueryEvaluator()
    let viewModel = LibraryViewModel(
        settings: fixture.settings,
        queryEvaluator: evaluator.evaluate
    )

    viewModel.load(root: fixture.rootURL)
    try await waitUntil {
        !viewModel.isScanning && viewModel.visibleItems.count == 2
    }
    let selected = try #require(
        viewModel.visibleItems.first(where: { $0.filename == "keep.mp4" })
    )
    viewModel.select(selected)
    evaluator.resetHistory()

    viewModel.searchText = "slow"
    try await waitUntil { evaluator.slowQueryStarted }
    #expect(viewModel.isApplyingQuery)

    viewModel.setVerdict(.keep)
    #expect(viewModel.annotation(for: selected).verdict == .keep)

    evaluator.releaseSlowQuery()
    try await waitUntil { !viewModel.isApplyingQuery }
    #expect(await viewModel.flushPendingAnnotationSaves())
}

@Test @MainActor
func immediateFlushPersistsLatestAnnotationBeforeDebounce() async throws {
    let fixture = try ResponsiveLibraryFixture(filenames: ["latest.png"])
    defer { fixture.remove() }
    let viewModel = LibraryViewModel(settings: fixture.settings)

    viewModel.load(root: fixture.rootURL)
    try await waitUntil {
        !viewModel.isScanning && viewModel.visibleItems.count == 1
    }

    let item = try #require(viewModel.visibleItems.first)
    viewModel.select(item)
    viewModel.setVerdict(.keep)
    await viewModel.flushPendingAnnotationSaves()

    let persisted = try MetadataStore(root: fixture.rootURL)
    #expect(persisted.annotations[item.relativePath]?.verdict == .keep)
}

@Test @MainActor
func reopeningSameRootFlushesPendingAnnotationBeforeReload() async throws {
    let fixture = try ResponsiveLibraryFixture(filenames: ["reopen.png"])
    defer { fixture.remove() }
    let viewModel = LibraryViewModel(settings: fixture.settings)

    viewModel.load(root: fixture.rootURL)
    try await waitUntil {
        !viewModel.isScanning && viewModel.visibleItems.count == 1
    }

    let item = try #require(viewModel.visibleItems.first)
    viewModel.select(item)
    viewModel.setVerdict(.keep)
    viewModel.load(root: fixture.rootURL)

    try await waitUntil {
        !viewModel.hasPendingAnnotationSaves
            && !viewModel.isScanning
            && viewModel.annotations[item.relativePath]?.verdict == .keep
    }
    #expect(
        try MetadataStore(root: fixture.rootURL)
            .annotations[item.relativePath]?.verdict == .keep
    )
}

@Test @MainActor
func repeatedTerminationRequestKeepsWaitingForPendingSave() async throws {
    let fixture = try ResponsiveLibraryFixture(filenames: ["quit.png"])
    defer { fixture.remove() }
    let viewModel = LibraryViewModel(settings: fixture.settings)

    viewModel.load(root: fixture.rootURL)
    try await waitUntil {
        !viewModel.isScanning && viewModel.visibleItems.count == 1
    }

    let item = try #require(viewModel.visibleItems.first)
    viewModel.select(item)
    viewModel.setVerdict(.keep)
    #expect(viewModel.hasPendingAnnotationSaves)

    let delegate = RalphyMediaApplicationDelegate()
    delegate.attach(viewModel: viewModel)
    let application = NSApplication.shared

    #expect(delegate.applicationShouldTerminate(application) == .terminateLater)
    #expect(delegate.applicationShouldTerminate(application) == .terminateLater)

    try await waitUntil { !viewModel.hasPendingAnnotationSaves }
    #expect(
        try MetadataStore(root: fixture.rootURL)
            .annotations[item.relativePath]?.verdict == .keep
    )
}

@Test @MainActor
func batchTrashIsNonblockingAndReconcilesPartialFailure() async throws {
    let fixture = try ResponsiveLibraryFixture(filenames: ["fail.png", "remove.png"])
    defer { fixture.remove() }
    let operation = BlockingTrashOperation()
    let viewModel = LibraryViewModel(
        settings: fixture.settings,
        trashItem: operation.trash
    )

    viewModel.load(root: fixture.rootURL)
    try await waitUntil {
        !viewModel.isScanning && viewModel.visibleItems.count == 2
    }
    viewModel.selectAllVisible()
    viewModel.requestTrash()
    viewModel.confirmTrash()

    #expect(viewModel.isTrashing)
    #expect(viewModel.trashProgress?.total == 2)
    try await waitUntil { operation.removeStarted }
    #expect(viewModel.isTrashing)

    operation.releaseRemove()
    try await waitUntil {
        !viewModel.isTrashing && viewModel.items.count == 1
    }

    #expect(viewModel.items.map(\.filename) == ["fail.png"])
    #expect(viewModel.selectedIDs == Set(viewModel.items.map(\.id)))
    #expect(viewModel.errorMessage?.contains("fail.png") == true)
    #expect(!operation.ranOnMainThread)
}

@Test @MainActor
func acceptedFilterIntersectsSelectionAndRepairsPrimaryItem() async throws {
    let fixture = try ResponsiveLibraryFixture(filenames: ["keep.png", "hide.png"])
    defer { fixture.remove() }
    let viewModel = LibraryViewModel(settings: fixture.settings)

    viewModel.load(root: fixture.rootURL)
    try await waitUntil {
        !viewModel.isScanning && viewModel.visibleItems.count == 2
    }
    viewModel.selectAllVisible()

    viewModel.searchText = "keep"
    try await waitUntil {
        viewModel.visibleItems.map(\.filename) == ["keep.png"]
            && !viewModel.isApplyingQuery
    }

    let kept = try #require(viewModel.visibleItems.first)
    #expect(viewModel.selectedIDs == [kept.id])
    #expect(viewModel.primarySelection?.id == kept.id)
}

@Test @MainActor
func reopeningSameRootRecoversFromStaleMetadataRevision() async throws {
    let fixture = try ResponsiveLibraryFixture(filenames: ["revision.png"])
    defer { fixture.remove() }
    let viewModel = LibraryViewModel(settings: fixture.settings)

    viewModel.load(root: fixture.rootURL)
    try await waitUntil {
        !viewModel.isScanning && viewModel.visibleItems.count == 1
    }
    let item = try #require(viewModel.visibleItems.first)

    var external = try MetadataStore(root: fixture.rootURL)
    external.annotations[item.relativePath] = MediaAnnotation(verdict: .maybe)
    try external.save()

    viewModel.select(item)
    viewModel.setVerdict(.keep)
    #expect(await !viewModel.flushPendingAnnotationSaves())

    viewModel.load(root: fixture.rootURL)
    try await waitUntil {
        !viewModel.isScanning
            && viewModel.annotations[item.relativePath]?.verdict == .maybe
    }

    let reloadedItem = try #require(viewModel.visibleItems.first)
    viewModel.select(reloadedItem)
    viewModel.setVerdict(.keep)
    #expect(await viewModel.flushPendingAnnotationSaves())

    let persisted = try MetadataStore(root: fixture.rootURL)
    #expect(persisted.annotations[item.relativePath]?.verdict == .keep)
}

@Test @MainActor
func reopeningSameRootRetainsPendingAnnotationAfterTransientSaveFailure() async throws {
    let fixture = try ResponsiveLibraryFixture(filenames: ["retry.png"])
    defer { fixture.remove() }
    let viewModel = LibraryViewModel(
        settings: fixture.settings,
        annotationSave: { _ in
            throw ResponsiveLibraryTestError.intentionalSaveFailure
        }
    )

    viewModel.load(root: fixture.rootURL)
    try await waitUntil {
        !viewModel.isScanning && viewModel.visibleItems.count == 1
    }

    let item = try #require(viewModel.visibleItems.first)
    viewModel.select(item)
    viewModel.setVerdict(.keep)
    viewModel.load(root: fixture.rootURL)

    try await waitUntil {
        viewModel.errorMessage?.contains("Annotations were not saved") == true
    }
    #expect(viewModel.hasPendingAnnotationSaves)
    #expect(viewModel.annotation(for: item).verdict == .keep)
    #expect(try MetadataStore(root: fixture.rootURL).annotations[item.relativePath] == nil)
}

@Test @MainActor
func terminationWaitsForTrashAndLibraryChangeIsBlocked() async throws {
    let fixture = try ResponsiveLibraryFixture(filenames: ["remove.png"])
    defer { fixture.remove() }
    let other = try ResponsiveLibraryFixture(filenames: ["other.png"])
    defer { other.remove() }
    let operation = BlockingTrashOperation()
    let viewModel = LibraryViewModel(
        settings: fixture.settings,
        trashItem: operation.trash
    )

    viewModel.load(root: fixture.rootURL)
    try await waitUntil {
        !viewModel.isScanning && viewModel.visibleItems.count == 1
    }
    viewModel.selectAllVisible()
    viewModel.requestTrash()
    viewModel.confirmTrash()
    try await waitUntil { operation.removeStarted }

    let delegate = RalphyMediaApplicationDelegate()
    delegate.attach(viewModel: viewModel)
    let application = NSApplication.shared
    #expect(delegate.applicationShouldTerminate(application) == .terminateLater)
    #expect(viewModel.isTerminating)

    let selected = try #require(viewModel.visibleItems.first)
    viewModel.setVerdict(.keep)
    #expect(viewModel.annotation(for: selected).verdict == .unreviewed)
    #expect(!viewModel.hasPendingAnnotationSaves)

    viewModel.load(root: other.rootURL)
    try await Task.sleep(for: .milliseconds(700))
    #expect(viewModel.rootURL?.path == fixture.rootURL.standardizedFileURL.path)
    #expect(viewModel.errorMessage?.contains("Trash operation") == true)

    operation.releaseRemove()
    try await waitUntil { !viewModel.isTrashing }
    #expect(viewModel.items.isEmpty)
}

@Test @MainActor
func pendingRootLoadCannotCompleteAfterTrashStarts() async throws {
    let rootB = try ResponsiveLibraryFixture(filenames: ["pending.png"])
    defer { rootB.remove() }
    let rootA = try ResponsiveLibraryFixture(filenames: ["remove.png"])
    defer { rootA.remove() }
    let saves = BlockingAnnotationSaveOperation()
    let trash = BlockingTrashOperation()
    defer {
        Task { await saves.releaseAll() }
        trash.releaseRemove()
    }
    let viewModel = LibraryViewModel(
        settings: rootB.settings,
        trashItem: trash.trash,
        annotationSave: { store in
            try await saves.save(store)
        }
    )

    viewModel.load(root: rootB.rootURL)
    try await waitUntil {
        !viewModel.isScanning
            && !viewModel.isApplyingQuery
            && viewModel.visibleItems.count == 1
    }
    let pendingItem = try #require(viewModel.visibleItems.first)
    viewModel.select(pendingItem)
    viewModel.setVerdict(.keep)

    viewModel.load(root: rootA.rootURL)
    try await waitUntil {
        viewModel.rootURL?.path == rootA.rootURL.standardizedFileURL.path
            && !viewModel.isScanning
            && !viewModel.isApplyingQuery
            && viewModel.visibleItems.count == 1
    }

    viewModel.load(root: rootB.rootURL)
    try await waitUntilAsync { await saves.startedCount >= 2 }

    viewModel.selectAllVisible()
    viewModel.requestTrash()
    viewModel.confirmTrash()
    try await waitUntil { trash.removeStarted }

    await saves.releaseAll()
    try await Task.sleep(for: .milliseconds(900))
    #expect(viewModel.rootURL?.path == rootA.rootURL.standardizedFileURL.path)
    #expect(viewModel.isTrashing)

    trash.releaseRemove()
    try await waitUntil { !viewModel.isTrashing }
}

@Test @MainActor
func invalidatedRootLoadConflictKeepsPendingAnnotations() async throws {
    let fixture = try ResponsiveLibraryFixture(filenames: ["remove.png"])
    defer { fixture.remove() }
    let metadataURL = fixture.rootURL.appending(path: "media-library/library.json")
    let saves = BlockingAnnotationSaveOperation(
        failure: .conflict(metadataURL)
    )
    let trash = BlockingTrashOperation()
    defer {
        Task { await saves.releaseAll() }
        trash.releaseRemove()
    }
    let viewModel = LibraryViewModel(
        settings: fixture.settings,
        trashItem: trash.trash,
        annotationSave: { store in
            try await saves.save(store)
        }
    )

    viewModel.load(root: fixture.rootURL)
    try await waitUntil {
        !viewModel.isScanning
            && !viewModel.isApplyingQuery
            && viewModel.visibleItems.count == 1
    }
    let item = try #require(viewModel.visibleItems.first)
    viewModel.select(item)
    viewModel.setVerdict(.keep)
    viewModel.load(root: fixture.rootURL)
    try await waitUntilAsync { await saves.startedCount >= 1 }

    viewModel.requestTrash()
    viewModel.confirmTrash()
    try await waitUntil { trash.removeStarted }

    await saves.releaseAll()
    try await waitUntil { viewModel.errorMessage != nil }
    try await Task.sleep(for: .milliseconds(100))
    #expect(viewModel.hasPendingAnnotationSaves)
    #expect(viewModel.annotation(for: item).verdict == .keep)

    trash.releaseRemove()
    try await waitUntil { !viewModel.isTrashing }
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
            throw ResponsiveLibraryTestError.timedOut
        }
        try await Task.sleep(for: .milliseconds(20))
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
            throw ResponsiveLibraryTestError.timedOut
        }
        try await Task.sleep(for: .milliseconds(20))
    }
}

private enum ResponsiveLibraryTestError: Error {
    case timedOut
    case intentionalTrashFailure
    case intentionalSaveFailure
}

private final class BlockingQueryEvaluator: @unchecked Sendable {
    private let condition = NSCondition()
    private var slowStarted = false
    private var releaseSlow = false
    private var observedMainThread = false
    private var queries: [String] = []
    private var concurrentQueries = 0
    private var maximumConcurrent = 0

    var slowQueryStarted: Bool {
        condition.withLock { slowStarted }
    }

    var ranOnMainThread: Bool {
        condition.withLock { observedMainThread }
    }

    var startedQueries: [String] {
        condition.withLock { queries }
    }

    var maximumConcurrentQueries: Int {
        condition.withLock { maximumConcurrent }
    }

    func evaluate(
        query: MediaQuery,
        items: [MediaItem],
        annotations: [String: MediaAnnotation]
    ) -> [MediaSection] {
        condition.lock()
        observedMainThread = observedMainThread || Thread.isMainThread
        queries.append(query.search ?? "")
        concurrentQueries += 1
        maximumConcurrent = max(maximumConcurrent, concurrentQueries)
        if query.search == "slow" {
            slowStarted = true
            condition.broadcast()
            while !releaseSlow {
                condition.wait()
            }
        }
        concurrentQueries -= 1
        condition.unlock()
        return query.sections(from: items, annotations: annotations)
    }

    func releaseSlowQuery() {
        condition.withLock {
            releaseSlow = true
            condition.broadcast()
        }
    }

    func resetHistory() {
        condition.withLock {
            queries = []
            maximumConcurrent = concurrentQueries
        }
    }
}

private final class BlockingTrashOperation: @unchecked Sendable {
    private let condition = NSCondition()
    private var started = false
    private var release = false
    private var observedMainThread = false

    var removeStarted: Bool {
        condition.withLock { started }
    }

    var ranOnMainThread: Bool {
        condition.withLock { observedMainThread }
    }

    func trash(_ url: URL) throws {
        condition.lock()
        observedMainThread = observedMainThread || Thread.isMainThread
        if url.lastPathComponent == "remove.png" {
            started = true
            condition.broadcast()
            while !release {
                condition.wait()
            }
        }
        condition.unlock()

        if url.lastPathComponent == "fail.png" {
            throw ResponsiveLibraryTestError.intentionalTrashFailure
        }
        try FileManager.default.removeItem(at: url)
    }

    func releaseRemove() {
        condition.withLock {
            release = true
            condition.broadcast()
        }
    }
}

private actor BlockingAnnotationSaveOperation {
    private let failure: MetadataStoreError?
    private(set) var startedCount = 0
    private var released = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    init(failure: MetadataStoreError? = nil) {
        self.failure = failure
    }

    func save(_ store: MetadataStore) async throws -> MetadataStore {
        startedCount += 1
        if !released {
            await withCheckedContinuation { waiters.append($0) }
        }
        if let failure {
            throw failure
        }
        return store
    }

    func releaseAll() {
        released = true
        waiters.forEach { $0.resume() }
        waiters.removeAll()
    }
}

private struct ResponsiveLibraryFixture {
    let containerURL: URL
    let rootURL: URL
    let projectURL: URL
    let defaultsSuite: String
    let settings: AppSettings

    init(filenames: [String]) throws {
        containerURL = FileManager.default.temporaryDirectory
            .appending(path: "RalphyMedia-\(UUID().uuidString)")
        rootURL = containerURL.appending(path: ".ralphy")
        projectURL = rootURL.appending(
            path: "workspaces/test/projects/responsive/render/final"
        )
        defaultsSuite = "app.ralphy.media.tests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: defaultsSuite))
        defaults.removePersistentDomain(forName: defaultsSuite)
        settings = AppSettings(defaults: defaults)
        try FileManager.default.createDirectory(
            at: projectURL,
            withIntermediateDirectories: true
        )
        for filename in filenames {
            try Data(filename.utf8).write(to: projectURL.appending(path: filename))
        }
    }

    func remove() {
        try? FileManager.default.removeItem(at: containerURL)
        UserDefaults.standard.removePersistentDomain(forName: defaultsSuite)
    }
}
