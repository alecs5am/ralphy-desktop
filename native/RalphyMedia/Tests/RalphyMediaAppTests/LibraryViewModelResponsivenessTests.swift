import AppKit
import Foundation
import RalphyMediaCore
import Testing
@testable import RalphyMediaApp

@Test @MainActor
func openingLibraryPublishesCatalogWithoutScanningMedia() async throws {
    let fixture = try ResponsiveLibraryFixture(
        filenames: ["first.mp4"],
        restoreProject: false
    )
    defer { fixture.remove() }
    _ = try fixture.addProject(
        workspaceID: "second-workspace",
        projectID: "second-project",
        filenames: ["second.mp4"]
    )
    let recorder = LoadRecorder()
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
        },
        ledgerLoad: { project, root in
            await recorder.loadLedger(project: project, root: root)
        }
    )

    viewModel.load(root: fixture.rootURL)
    try await waitUntil {
        !viewModel.isLoadingCatalog && viewModel.workspaces.count == 2
    }

    #expect(await recorder.catalogCount == 1)
    #expect(await recorder.projectReferences.isEmpty)
    #expect(await recorder.ledgerReferences.isEmpty)
    #expect(viewModel.route == .library)
    #expect(viewModel.items.isEmpty)
}

@Test @MainActor
func enteringProjectScansOnlyThatProjectReference() async throws {
    let fixture = try ResponsiveLibraryFixture(
        filenames: ["selected.mp4"],
        restoreProject: false
    )
    defer { fixture.remove() }
    let other = try fixture.addProject(
        projectID: "other",
        filenames: ["ignored.mp4"]
    )
    let recorder = LoadRecorder()
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
    try await waitUntil { !viewModel.isLoadingCatalog }
    viewModel.enterProject(fixture.projectReference)
    try await waitUntil {
        !viewModel.isLoadingProject && viewModel.items.count == 1
    }

    #expect(await recorder.projectReferences == [fixture.projectReference])
    #expect(!viewModel.items.contains { $0.project == other.projectID })
    #expect(viewModel.route == .project(fixture.projectReference))
}

@Test @MainActor
func rapidProjectSwitchSerializesScansAndRunsOnlyTheNewestRequest() async throws {
    let fixture = try ResponsiveLibraryFixture(
        filenames: ["stale.mp4"],
        restoreProject: false
    )
    defer { fixture.remove() }
    let current = try fixture.addProject(
        projectID: "current",
        filenames: ["current.mp4"]
    )
    let newest = try fixture.addProject(
        projectID: "newest",
        filenames: ["newest.mp4"]
    )
    let scanner = SwitchingProjectScanner(blocked: fixture.projectReference)
    defer { Task { await scanner.releaseBlockedScan() } }
    let viewModel = LibraryViewModel(
        settings: fixture.settings,
        projectScan: { project, root, options, attributions in
            try await scanner.scan(
                project: project,
                root: root,
                options: options,
                attributions: attributions
            )
        }
    )

    viewModel.load(root: fixture.rootURL)
    try await waitUntil { !viewModel.isLoadingCatalog }
    let stale = fixture.projectReference
    viewModel.enterProject(stale)
    try await waitUntilAsync {
        await scanner.hasStarted(stale)
    }
    viewModel.enterProject(current)
    viewModel.enterProject(newest)
    #expect(viewModel.route == .project(newest))
    #expect(viewModel.items.isEmpty)
    #expect(viewModel.isLoadingProject)

    try await Task.sleep(for: .milliseconds(150))
    #expect(await scanner.startedProjects == [stale])
    #expect(await scanner.maximumConcurrentScans == 1)

    await scanner.releaseBlockedScan()
    try await waitUntilAsync { await scanner.hasStarted(newest) }
    try await waitUntil {
        !viewModel.isLoadingProject
            && viewModel.items.map(\.filename) == ["newest.mp4"]
    }

    try await Task.sleep(for: .milliseconds(200))
    #expect(viewModel.route == .project(newest))
    #expect(viewModel.items.map(\.filename) == ["newest.mp4"])
    #expect(await scanner.startedProjects == [stale, newest])
    #expect(await scanner.maximumConcurrentScans == 1)
}

@Test @MainActor
func rapidRootSwitchRejectsStaleCatalog() async throws {
    let staleFixture = try ResponsiveLibraryFixture(
        filenames: ["stale.mp4"],
        restoreProject: false
    )
    defer { staleFixture.remove() }
    _ = try staleFixture.addProject(
        workspaceID: "stale-workspace",
        projectID: "stale-project",
        filenames: []
    )
    let currentFixture = try ResponsiveLibraryFixture(
        filenames: ["current.mp4"],
        restoreProject: false
    )
    defer { currentFixture.remove() }
    _ = try currentFixture.addProject(
        workspaceID: "current-workspace",
        projectID: "current-project",
        filenames: []
    )
    let scanner = SwitchingCatalogScanner(blockedRoot: staleFixture.rootURL)
    let viewModel = LibraryViewModel(
        settings: staleFixture.settings,
        catalogScan: { root in
            try await scanner.scan(root: root)
        }
    )

    let staleRoot = staleFixture.rootURL
    viewModel.load(root: staleRoot)
    try await waitUntilAsync {
        await scanner.hasStarted(staleRoot)
    }
    viewModel.load(root: currentFixture.rootURL)
    try await waitUntil {
        !viewModel.isLoadingCatalog
            && viewModel.rootURL == currentFixture.rootURL.standardizedFileURL
    }
    await scanner.releaseBlockedScan()
    try await Task.sleep(for: .milliseconds(200))

    #expect(viewModel.rootURL == currentFixture.rootURL.standardizedFileURL)
    #expect(viewModel.catalog.workspaces.contains { $0.id == "current-workspace" })
    #expect(!viewModel.catalog.workspaces.contains { $0.id == "stale-workspace" })
}

@Test @MainActor
func rootContextLoaderReadsMetadataOffMainThread() async throws {
    let fixture = try ResponsiveLibraryFixture(
        filenames: [],
        restoreProject: false
    )
    defer { fixture.remove() }
    let loader = RootContextThreadRecorder()
    let expectedRoot = fixture.rootURL.standardizedFileURL
    let viewModel = LibraryViewModel(
        settings: fixture.settings,
        rootContextLoad: { root in
            try loader.load(root: root)
        }
    )

    viewModel.load(root: fixture.rootURL)
    try await waitUntil {
        !viewModel.isLoadingCatalog && viewModel.rootURL == expectedRoot
    }

    #expect(!loader.ranOnMainThread)
}

@Test @MainActor
func rapidRootSwitchRejectsStaleRootContext() async throws {
    let staleFixture = try ResponsiveLibraryFixture(
        filenames: [],
        restoreProject: false
    )
    defer { staleFixture.remove() }
    let currentFixture = try ResponsiveLibraryFixture(
        filenames: [],
        restoreProject: false
    )
    defer { currentFixture.remove() }
    let loader = SwitchingRootContextLoader(
        blockedRoot: staleFixture.rootURL
    )
    let staleRoot = staleFixture.rootURL
    defer { Task { await loader.releaseBlockedLoad() } }
    let viewModel = LibraryViewModel(
        settings: staleFixture.settings,
        rootContextLoad: { root in
            try await loader.load(root: root)
        }
    )

    viewModel.load(root: staleRoot)
    try await waitUntilAsync {
        await loader.hasStarted(staleRoot)
    }
    viewModel.load(root: currentFixture.rootURL)
    try await waitUntil {
        !viewModel.isLoadingCatalog
            && viewModel.rootURL == currentFixture.rootURL.standardizedFileURL
    }

    await loader.releaseBlockedLoad()
    try await Task.sleep(for: .milliseconds(200))
    #expect(viewModel.rootURL == currentFixture.rootURL.standardizedFileURL)
}

@Test @MainActor
func catalogRefreshPreservesAnnotationsEditedWhileItLoads() async throws {
    let fixture = try ResponsiveLibraryFixture(filenames: ["review.png"])
    defer { fixture.remove() }
    let scanner = RefreshBlockingCatalogScanner()
    let viewModel = LibraryViewModel(
        settings: fixture.settings,
        catalogScan: { root in
            try await scanner.scan(root: root)
        }
    )

    viewModel.load(root: fixture.rootURL)
    try await waitUntil {
        !viewModel.isLoadingCatalog
            && !viewModel.isLoadingProject
            && !viewModel.isApplyingQuery
            && viewModel.visibleItems.count == 1
    }
    let item = try #require(viewModel.visibleItems.first)

    await viewModel.refreshCatalog()
    try await waitUntilAsync { await scanner.refreshStarted }
    viewModel.select(item)
    viewModel.setVerdict(.keep)
    #expect(viewModel.annotation(for: item).verdict == .keep)

    await scanner.releaseRefresh()
    try await waitUntil { !viewModel.isLoadingCatalog }
    #expect(viewModel.annotation(for: item).verdict == .keep)
}

@Test @MainActor
func trashRetiresABlockedCatalogRefresh() async throws {
    let fixture = try ResponsiveLibraryFixture(filenames: ["remove.png"])
    defer { fixture.remove() }
    let scanner = RefreshBlockingCatalogScanner()
    defer { Task { await scanner.releaseRefresh() } }
    let viewModel = LibraryViewModel(
        settings: fixture.settings,
        catalogScan: { root in
            try await scanner.scan(root: root)
        },
        trashItem: { url in
            try FileManager.default.removeItem(at: url)
        }
    )

    viewModel.load(root: fixture.rootURL)
    try await waitUntil {
        !viewModel.isScanning
            && !viewModel.isApplyingQuery
            && viewModel.visibleItems.count == 1
    }
    await viewModel.refreshCatalog()
    try await waitUntilAsync { await scanner.refreshStarted }
    #expect(viewModel.isLoadingCatalog)

    viewModel.selectAllVisible()
    viewModel.requestTrash()
    viewModel.confirmTrash()

    #expect(!viewModel.isLoadingCatalog)
    #expect(viewModel.catalogTask == nil)
    try await waitUntil { !viewModel.isTrashing }
    await scanner.releaseRefresh()
    try await Task.sleep(for: .milliseconds(100))
    #expect(!viewModel.isLoadingCatalog)
}

@Test @MainActor
func failedTerminationRollbackRetiresABlockedCatalogRefresh() async throws {
    let fixture = try ResponsiveLibraryFixture(filenames: ["keep.png"])
    defer { fixture.remove() }
    let scanner = RefreshBlockingCatalogScanner()
    defer { Task { await scanner.releaseRefresh() } }
    let viewModel = LibraryViewModel(
        settings: fixture.settings,
        catalogScan: { root in
            try await scanner.scan(root: root)
        },
        annotationSave: { _ in
            throw ResponsiveLibraryTestError.intentionalSaveFailure
        }
    )

    viewModel.load(root: fixture.rootURL)
    try await waitUntil {
        !viewModel.isScanning
            && !viewModel.isApplyingQuery
            && viewModel.visibleItems.count == 1
    }
    viewModel.selectAllVisible()
    viewModel.setVerdict(.keep)
    #expect(viewModel.hasPendingAnnotationSaves)

    await viewModel.refreshCatalog()
    try await waitUntilAsync { await scanner.refreshStarted }
    #expect(viewModel.isLoadingCatalog)

    viewModel.beginTermination()
    #expect(!viewModel.isLoadingCatalog)
    #expect(viewModel.catalogTask == nil)
    #expect(await !viewModel.completePendingTerminationWork())
    viewModel.cancelTermination()

    #expect(!viewModel.isTerminating)
    #expect(!viewModel.isLoadingCatalog)
    #expect(viewModel.catalogTask == nil)
    await scanner.releaseRefresh()
    try await Task.sleep(for: .milliseconds(100))
    #expect(!viewModel.isLoadingCatalog)
}

@Test @MainActor
func projectSwitchRejectsStaleLedgerHydration() async throws {
    let fixture = try ResponsiveLibraryFixture(
        filenames: ["stale.mp4"],
        restoreProject: false
    )
    defer { fixture.remove() }
    let current = try fixture.addProject(
        projectID: "current-ledger",
        filenames: ["current.mp4"]
    )
    let ledger = SwitchingLedgerLoader(blocked: fixture.projectReference)
    let viewModel = LibraryViewModel(
        settings: fixture.settings,
        ledgerLoad: { project, root in
            await ledger.load(project: project, root: root)
        }
    )

    viewModel.load(root: fixture.rootURL)
    try await waitUntil { !viewModel.isLoadingCatalog }
    let staleProject = fixture.projectReference
    viewModel.enterProject(staleProject)
    try await waitUntilAsync {
        await ledger.hasStarted(staleProject)
    }
    viewModel.enterProject(current)
    try await waitUntil {
        viewModel.route == .project(current)
            && !viewModel.isLoadingCosts
            && viewModel.projectSpendUSD == 2
    }

    await ledger.releaseBlockedLoad()
    try await Task.sleep(for: .milliseconds(200))
    #expect(viewModel.route == .project(current))
    #expect(viewModel.projectSpendUSD == 2)
}

@Test @MainActor
func ledgerHydrationDecoratesOnlySelectedProjectItems() async throws {
    let fixture = try ResponsiveLibraryFixture(
        filenames: ["generated.mp4"],
        restoreProject: false
    )
    defer { fixture.remove() }
    let recorder = LoadRecorder(
        ledgerSummary: GenerationLedgerSummary(
            totalSpendUSD: 0.75,
            lastActivityAt: nil,
            attributions: [
                "render/final/generated.mp4": GenerationAttribution(
                    costUSD: 0.75,
                    provider: "test",
                    model: "deterministic",
                    generatedAt: nil
                ),
            ],
            malformedLineCount: 0,
            indexedByteOffset: 0
        )
    )
    let viewModel = LibraryViewModel(
        settings: fixture.settings,
        projectScan: { project, root, options, attributions in
            try await recorder.scanProject(
                project: project,
                root: root,
                options: options,
                attributions: attributions
            )
        },
        ledgerLoad: { project, root in
            await recorder.loadLedger(project: project, root: root)
        }
    )

    viewModel.load(root: fixture.rootURL)
    try await waitUntil { !viewModel.isLoadingCatalog }
    viewModel.enterProject(fixture.projectReference)
    try await waitUntil {
        !viewModel.isLoadingProject
            && !viewModel.isLoadingCosts
            && viewModel.items.first?.generation?.costUSD == 0.75
    }

    #expect(viewModel.projectSpendUSD == 0.75)
    #expect(await recorder.projectReferences == [
        fixture.projectReference,
        fixture.projectReference,
    ])
    #expect(await recorder.ledgerReferences == [fixture.projectReference])
}

@Test @MainActor
func assetNavigationRestoresGridPresentationState() async throws {
    let fixture = try ResponsiveLibraryFixture(
        filenames: ["first.mp4", "second.mp4"]
    )
    defer { fixture.remove() }
    let viewModel = LibraryViewModel(settings: fixture.settings)

    viewModel.load(root: fixture.rootURL)
    try await waitUntil {
        !viewModel.isScanning
            && !viewModel.isApplyingQuery
            && viewModel.visibleItems.count == 2
    }
    let first = try #require(viewModel.visibleItems.first)
    let second = try #require(viewModel.visibleItems.last)
    viewModel.select(first)
    viewModel.updateScrollAnchor(second.id)
    viewModel.openAsset(first)
    #expect(viewModel.route == .asset(fixture.projectReference, first.id))

    viewModel.showNextAsset()
    #expect(viewModel.route == .asset(fixture.projectReference, second.id))
    viewModel.showPreviousAsset()
    #expect(viewModel.route == .asset(fixture.projectReference, first.id))
    viewModel.searchText = "changed-in-viewer"
    viewModel.clearSelection()
    viewModel.updateScrollAnchor(nil)
    viewModel.goBack()

    #expect(viewModel.route == .project(fixture.projectReference))
    #expect(viewModel.searchText.isEmpty)
    #expect(viewModel.selectedIDs == [first.id])
    #expect(viewModel.scrollAnchorID == second.id)
}

@Test @MainActor
func restoringWorkspaceDoesNotRestoreMissingProject() async throws {
    let fixture = try ResponsiveLibraryFixture(
        filenames: ["valid.mp4"],
        restoreProject: false
    )
    defer { fixture.remove() }
    fixture.settings.selectedWorkspaceID = fixture.projectReference.workspaceID
    fixture.settings.selectedProjectID = "missing"
    let recorder = LoadRecorder()
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
    try await waitUntil { !viewModel.isLoadingCatalog }

    #expect(viewModel.route == .workspace(fixture.projectReference.workspaceID))
    #expect(await recorder.projectReferences.isEmpty)
    #expect(viewModel.items.isEmpty)
}

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
    let scanner = RefreshBlockingCatalogScanner(refreshResult: .empty)
    defer { Task { await scanner.releaseRefresh() } }
    let viewModel = LibraryViewModel(
        settings: fixture.settings,
        catalogScan: { root in
            try await scanner.scan(root: root)
        },
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
    let workspaceIDs = viewModel.catalog.workspaces.map(\.id)

    await viewModel.refreshCatalog()
    try await waitUntilAsync { await scanner.refreshStarted }
    #expect(viewModel.isLoadingCatalog)

    viewModel.load(root: fixture.rootURL)

    try await waitUntil {
        viewModel.errorMessage?.contains("Annotations were not saved") == true
    }
    #expect(!viewModel.isLoadingCatalog)
    #expect(viewModel.catalogTask == nil)
    #expect(viewModel.hasPendingAnnotationSaves)
    #expect(viewModel.annotation(for: item).verdict == .keep)
    #expect(try MetadataStore(root: fixture.rootURL).annotations[item.relativePath] == nil)

    await scanner.releaseRefresh()
    try await waitUntilAsync { await scanner.refreshFinished }
    await Task.yield()
    #expect(!viewModel.isLoadingCatalog)
    #expect(viewModel.catalogTask == nil)
    #expect(viewModel.catalog.workspaces.map(\.id) == workspaceIDs)
    #expect(viewModel.hasPendingAnnotationSaves)
    #expect(viewModel.annotation(for: item).verdict == .keep)
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
    try await waitUntilAsync { await saves.startedCount >= 1 }

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

private final class RootContextThreadRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var observedMainThread = false

    var ranOnMainThread: Bool {
        lock.withLock { observedMainThread }
    }

    func load(root: URL) throws -> LibraryViewModel.LibraryContext {
        lock.withLock {
            observedMainThread = observedMainThread || Thread.isMainThread
        }
        let store = try MetadataStore(root: root)
        return LibraryViewModel.LibraryContext(
            root: root.standardizedFileURL,
            annotations: store.annotations,
            store: store,
            metadataWarning: nil
        )
    }
}

private actor SwitchingRootContextLoader {
    private let blockedRoot: URL
    private var startedRoots: Set<URL> = []
    private var released = false
    private var continuation: CheckedContinuation<Void, Never>?

    init(blockedRoot: URL) {
        self.blockedRoot = blockedRoot.standardizedFileURL
    }

    func load(root: URL) async throws -> LibraryViewModel.LibraryContext {
        let root = root.standardizedFileURL
        startedRoots.insert(root)
        if root == blockedRoot, !released {
            await withCheckedContinuation { continuation = $0 }
        }
        let store = try MetadataStore(root: root)
        return LibraryViewModel.LibraryContext(
            root: root,
            annotations: store.annotations,
            store: store,
            metadataWarning: nil
        )
    }

    func hasStarted(_ root: URL) -> Bool {
        startedRoots.contains(root.standardizedFileURL)
    }

    func releaseBlockedLoad() {
        released = true
        continuation?.resume()
        continuation = nil
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

private actor LoadRecorder {
    private let ledgerSummary: GenerationLedgerSummary
    private(set) var catalogCount = 0
    private(set) var projectReferences: [ProjectReference] = []
    private(set) var ledgerReferences: [ProjectReference] = []

    init(ledgerSummary: GenerationLedgerSummary = .empty) {
        self.ledgerSummary = ledgerSummary
    }

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
        projectReferences.append(project)
        return try MediaScanner().scan(
            project: project,
            root: root,
            options: options,
            attributions: attributions
        )
    }

    func loadLedger(
        project: ProjectReference,
        root: URL
    ) -> GenerationLedgerSummary {
        ledgerReferences.append(project)
        return ledgerSummary
    }
}

private actor SwitchingCatalogScanner {
    private let blockedRoot: URL
    private var startedRoots: Set<URL> = []
    private var released = false
    private var continuation: CheckedContinuation<Void, Never>?

    init(blockedRoot: URL) {
        self.blockedRoot = blockedRoot.standardizedFileURL
    }

    func scan(root: URL) async throws -> WorkspaceCatalogSnapshot {
        let root = root.standardizedFileURL
        startedRoots.insert(root)
        if root == blockedRoot, !released {
            await withCheckedContinuation { continuation = $0 }
        }
        return try WorkspaceCatalogScanner().scan(root: root)
    }

    func hasStarted(_ root: URL) -> Bool {
        startedRoots.contains(root.standardizedFileURL)
    }

    func releaseBlockedScan() {
        released = true
        continuation?.resume()
        continuation = nil
    }
}

private actor RefreshBlockingCatalogScanner {
    private let refreshResult: WorkspaceCatalogSnapshot?
    private var scanCount = 0
    private var continuation: CheckedContinuation<Void, Never>?
    private(set) var refreshFinished = false

    init(refreshResult: WorkspaceCatalogSnapshot? = nil) {
        self.refreshResult = refreshResult
    }

    var refreshStarted: Bool {
        scanCount >= 2
    }

    func scan(root: URL) async throws -> WorkspaceCatalogSnapshot {
        scanCount += 1
        if scanCount == 2 {
            await withCheckedContinuation { continuation = $0 }
            refreshFinished = true
            if let refreshResult {
                return refreshResult
            }
        }
        return try WorkspaceCatalogScanner().scan(root: root)
    }

    func releaseRefresh() {
        continuation?.resume()
        continuation = nil
    }
}

private actor SwitchingProjectScanner {
    private let blocked: ProjectReference
    private(set) var startedProjects: [ProjectReference] = []
    private(set) var maximumConcurrentScans = 0
    private var activeScans = 0
    private var released = false
    private var continuation: CheckedContinuation<Void, Never>?

    init(blocked: ProjectReference) {
        self.blocked = blocked
    }

    func scan(
        project: ProjectReference,
        root: URL,
        options: ScanOptions,
        attributions: [String: GenerationAttribution]
    ) async throws -> ScanResult {
        startedProjects.append(project)
        activeScans += 1
        maximumConcurrentScans = max(maximumConcurrentScans, activeScans)
        defer { activeScans -= 1 }
        if project == blocked, !released {
            await withCheckedContinuation { continuation = $0 }
        }
        return try MediaScanner().scan(
            project: project,
            root: root,
            options: options,
            attributions: attributions
        )
    }

    func hasStarted(_ project: ProjectReference) -> Bool {
        startedProjects.contains(project)
    }

    func releaseBlockedScan() {
        released = true
        continuation?.resume()
        continuation = nil
    }
}

private actor SwitchingLedgerLoader {
    private let blocked: ProjectReference
    private var started: Set<ProjectReference> = []
    private var released = false
    private var continuation: CheckedContinuation<Void, Never>?

    init(blocked: ProjectReference) {
        self.blocked = blocked
    }

    func load(
        project: ProjectReference,
        root: URL
    ) async -> GenerationLedgerSummary {
        started.insert(project)
        if project == blocked, !released {
            await withCheckedContinuation { continuation = $0 }
        }
        return GenerationLedgerSummary(
            totalSpendUSD: project == blocked ? 9 : 2,
            lastActivityAt: nil,
            attributions: [:],
            malformedLineCount: 0,
            indexedByteOffset: 0
        )
    }

    func hasStarted(_ project: ProjectReference) -> Bool {
        started.contains(project)
    }

    func releaseBlockedLoad() {
        released = true
        continuation?.resume()
        continuation = nil
    }
}

private struct ResponsiveLibraryFixture {
    let containerURL: URL
    let rootURL: URL
    let projectURL: URL
    let defaultsSuite: String
    let settings: AppSettings

    var projectReference: ProjectReference {
        ProjectReference(workspaceID: "test", projectID: "responsive")
    }

    init(
        filenames: [String],
        restoreProject: Bool = true
    ) throws {
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
        if restoreProject {
            settings.selectedWorkspaceID = projectReference.workspaceID
            settings.selectedProjectID = projectReference.projectID
        }
    }

    func addProject(
        workspaceID: String = "test",
        projectID: String,
        filenames: [String]
    ) throws -> ProjectReference {
        let directory = rootURL.appending(
            path: "workspaces/\(workspaceID)/projects/\(projectID)/render/final"
        )
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        for filename in filenames {
            try Data(filename.utf8).write(to: directory.appending(path: filename))
        }
        return ProjectReference(workspaceID: workspaceID, projectID: projectID)
    }

    func remove() {
        try? FileManager.default.removeItem(at: containerURL)
        UserDefaults.standard.removePersistentDomain(forName: defaultsSuite)
    }
}
