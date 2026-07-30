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
