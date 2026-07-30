import Foundation
import RalphyMediaCore
import Testing
@testable import RalphyMediaApp

@Test
func previewIdentityInvalidatesWhenModificationTimeOrSizeChanges() {
    let original = mediaItem(
        sizeBytes: 100,
        modifiedAt: Date(timeIntervalSince1970: 10)
    )
    let modified = mediaItem(
        sizeBytes: 100,
        modifiedAt: Date(timeIntervalSince1970: 11)
    )
    let resized = mediaItem(
        sizeBytes: 101,
        modifiedAt: Date(timeIntervalSince1970: 10)
    )

    #expect(PreviewIdentity(item: original) != PreviewIdentity(item: modified))
    #expect(PreviewIdentity(item: original) != PreviewIdentity(item: resized))
}

@Test
func gridNavigationMovesByRowsAndColumnsWithinBounds() {
    #expect(
        GridNavigation.targetIndex(
            current: 5,
            itemCount: 10,
            columnCount: 3,
            direction: .left
        ) == 4
    )
    #expect(
        GridNavigation.targetIndex(
            current: 5,
            itemCount: 10,
            columnCount: 3,
            direction: .right
        ) == 6
    )
    #expect(
        GridNavigation.targetIndex(
            current: 5,
            itemCount: 10,
            columnCount: 3,
            direction: .up
        ) == 2
    )
    #expect(
        GridNavigation.targetIndex(
            current: 5,
            itemCount: 10,
            columnCount: 3,
            direction: .down
        ) == 8
    )
    #expect(
        GridNavigation.targetIndex(
            current: 1,
            itemCount: 10,
            columnCount: 3,
            direction: .up
        ) == 0
    )
    #expect(
        GridNavigation.targetIndex(
            current: 8,
            itemCount: 10,
            columnCount: 3,
            direction: .down
        ) == 9
    )
}

@Test
func smartSourcesRecognizeAndApplyUsableAllAndRejectQueries() {
    let usable = LibrarySourceQuery.applying(.usable, to: MediaQuery())
    #expect(usable.excludeRejected)
    #expect(usable.verdict == nil)
    #expect(LibrarySourceQuery.selection(for: usable) == .usable)

    let all = LibrarySourceQuery.applying(.all, to: usable)
    #expect(!all.excludeRejected)
    #expect(LibrarySourceQuery.selection(for: all) == .all)

    let reject = LibrarySourceQuery.applying(.verdict(.reject), to: usable)
    #expect(!reject.excludeRejected)
    #expect(reject.verdict == .reject)
    #expect(LibrarySourceQuery.selection(for: reject) == .verdict(.reject))
}

@Test
func sourceCountsAggregateSmartWorkspaceAndProjectCountsOnce() {
    let keep = mediaItem(
        id: "keep",
        relativePath: "workspaces/one/projects/alpha/keep.png",
        workspace: "one",
        project: "alpha"
    )
    let reject = mediaItem(
        id: "reject",
        relativePath: "workspaces/one/projects/beta/reject.png",
        workspace: "one",
        project: "beta"
    )
    let unreviewed = mediaItem(
        id: "new",
        relativePath: "workspaces/two/projects/alpha/new.png",
        workspace: "two",
        project: "alpha"
    )
    let annotations = [
        keep.relativePath: MediaAnnotation(
            favorite: true,
            verdict: .keep
        ),
        reject.relativePath: MediaAnnotation(verdict: .reject),
    ]

    let counts = LibrarySourceCounts(
        items: [keep, reject, unreviewed],
        annotations: annotations
    )

    #expect(counts.count(for: .keep) == 1)
    #expect(counts.count(for: .reject) == 1)
    #expect(counts.count(for: .unreviewed) == 1)
    #expect(counts.favoriteCount == 1)
    #expect(counts.workspaces.map(\.0) == ["one", "two"])
    #expect(counts.workspaces.map(\.1) == [2, 1])
    #expect(counts.projects(in: "one").map(\.0) == ["alpha", "beta"])
    #expect(counts.projects(in: "one").map(\.1) == [1, 1])
    #expect(counts.projects(in: nil).map(\.0) == ["alpha", "beta"])
    #expect(counts.projects(in: nil).map(\.1) == [2, 1])
}

@Test
func recentProjectsSortNewestThenNameWithPinsFirst() {
    let recent = Date(timeIntervalSince1970: 300)
    let older = Date(timeIntervalSince1970: 100)
    let projects = [
        ProjectPresentationFixture(
            id: ProjectReference(workspaceID: "ws", projectID: "older-b"),
            name: "Older B",
            phase: .brief,
            lastActivityAt: older
        ),
        ProjectPresentationFixture(
            id: ProjectReference(workspaceID: "ws", projectID: "newest"),
            name: "Newest",
            phase: .render,
            lastActivityAt: recent
        ),
        ProjectPresentationFixture(
            id: ProjectReference(workspaceID: "ws", projectID: "older-a"),
            name: "Older A",
            phase: .plan,
            lastActivityAt: older
        ),
    ]

    let sorted = ProjectPresentation.sorted(
        projects,
        by: .recent,
        pinned: [projects[0].id]
    )

    #expect(sorted.map(\.id.projectID) == ["older-b", "newest", "older-a"])
}

@Test
func workspaceSortingSupportsRecentNameAndProjectCount() {
    let older = Date(timeIntervalSince1970: 100)
    let newer = Date(timeIntervalSince1970: 200)
    let workspaces = [
        WorkspacePresentationFixture(
            id: "zeta",
            name: "Zeta",
            projectCount: 2,
            lastActivityAt: older
        ),
        WorkspacePresentationFixture(
            id: "alpha",
            name: "Alpha",
            projectCount: 8,
            lastActivityAt: newer
        ),
    ]

    #expect(
        WorkspacePresentation.sorted(workspaces, by: .recent, pinned: []).map(\.id)
            == ["alpha", "zeta"]
    )
    #expect(
        WorkspacePresentation.sorted(workspaces, by: .name, pinned: []).map(\.id)
            == ["alpha", "zeta"]
    )
    #expect(
        WorkspacePresentation.sorted(workspaces, by: .projectCount, pinned: []).map(\.id)
            == ["alpha", "zeta"]
    )
}

@Test
func presentationLabelsAreHumanReadableAndNeverInventUnknownSpend() {
    let now = Date(timeIntervalSince1970: 10_000)

    #expect(WorkspacePresentation.activityDescription(nil, now: now) == "No activity")
    #expect(
        WorkspacePresentation.activityDescription(
            now.addingTimeInterval(-7_200),
            now: now
        ) == "2h ago"
    )
    #expect(ProjectPresentation.phaseLabel(.postmortem) == "Postmortem")
    #expect(ProjectPresentation.spendLabel(nil) == "Cost not indexed")
    #expect(ProjectPresentation.spendLabel(0) == "No charge")
    #expect(ProjectPresentation.spendLabel(1.25) == "$1.25")
}

@Test
func projectModesMapRalphyEntitiesAndNameEveryVisibleFilter() {
    #expect(ProjectPresentation.mode(for: .finalRender) == .finals)
    #expect(ProjectPresentation.mode(for: .generatedAsset) == .assets)
    #expect(ProjectPresentation.mode(for: .reference) == .refs)
    #expect(ProjectPresentation.mode(for: .unit) == .units)
    #expect(ProjectPresentation.mode(for: .lifecycleDocument) == .files)
    #expect(ProjectPresentation.mode(for: .productionFile) == .files)

    let text = ProjectPresentation.filterSummary(
        mode: .assets,
        bucket: .video,
        verdict: .keep,
        sort: .newest,
        group: .entity,
        includesIntermediates: true,
        gridSize: 220
    )

    #expect(
        text == "Assets · Video · Approved · Newest · Entity · Intermediates · Grid 220"
    )
}

private struct WorkspacePresentationFixture: WorkspacePresentable {
    let id: String
    let name: String
    let projectCount: Int
    let lastActivityAt: Date?
}

private struct ProjectPresentationFixture: ProjectPresentable {
    let id: ProjectReference
    let name: String
    let phase: ProjectPhase
    let lastActivityAt: Date?
}

private func mediaItem(
    id: String = "same-path",
    relativePath: String = "workspaces/one/projects/alpha/image.png",
    workspace: String = "one",
    project: String = "alpha",
    sizeBytes: Int64 = 100,
    modifiedAt: Date? = Date(timeIntervalSince1970: 10)
) -> MediaItem {
    MediaItem(
        id: id,
        url: URL(filePath: "/tmp/\(id).png"),
        relativePath: relativePath,
        workspace: workspace,
        project: project,
        bucket: .image,
        filename: "\(id).png",
        fileExtension: "png",
        sizeBytes: sizeBytes,
        createdAt: nil,
        modifiedAt: modifiedAt
    )
}
