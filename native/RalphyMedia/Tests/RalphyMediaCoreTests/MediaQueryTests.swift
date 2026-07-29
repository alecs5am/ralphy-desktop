import Foundation
import Testing
@testable import RalphyMediaCore

@Test func queryFiltersRejectedAndSortsNewestFirst() {
    let result = MediaQuery(verdict: .reject, sort: .newest).apply(
        to: queryItems,
        annotations: queryAnnotations
    )

    #expect(result.map(\.id) == ["new-reject", "old-reject"])
}

@Test func queryFiltersFavoritesWorkspaceProjectAndType() {
    let result = MediaQuery(
        favoriteOnly: true,
        workspace: "nightmaker",
        project: "hook",
        bucket: .video
    ).apply(to: queryItems, annotations: queryAnnotations)

    #expect(result.map(\.id) == ["new-reject"])
}

@Test func querySearchesNormalizedItemAndAnnotationText() {
    let result = MediaQuery(search: "cafe").apply(
        to: queryItems,
        annotations: queryAnnotations
    )

    #expect(result.map(\.id) == ["tagged-image"])
}

@Test func queryGroupsFilteredItemsByProject() {
    let sections = MediaQuery(group: .project).sections(
        from: queryItems,
        annotations: queryAnnotations
    )

    #expect(sections.map(\.title) == ["hook", "other"])
    #expect(sections[0].items.map(\.id) == ["tagged-image", "new-reject", "old-reject"])
    #expect(sections[1].items.map(\.id) == ["other-project"])
}

@Test func queryUsesRelativePathAsFinalSortTieBreaker() {
    let items = [
        queryItem(id: "b", relativePath: "b.mp4", workspace: "ws", project: "p", bucket: .video, modifiedAt: 1),
        queryItem(id: "a", relativePath: "a.mp4", workspace: "ws", project: "p", bucket: .video, modifiedAt: 1),
    ]

    let result = MediaQuery(sort: .newest).apply(to: items, annotations: [:])

    #expect(result.map(\.id) == ["a", "b"])
}

private let queryItems = [
    queryItem(
        id: "old-reject",
        relativePath: "workspaces/nightmaker/projects/hook/old.mp4",
        workspace: "nightmaker",
        project: "hook",
        bucket: .video,
        modifiedAt: 10
    ),
    queryItem(
        id: "new-reject",
        relativePath: "workspaces/nightmaker/projects/hook/new.mp4",
        workspace: "nightmaker",
        project: "hook",
        bucket: .video,
        modifiedAt: 20
    ),
    queryItem(
        id: "tagged-image",
        relativePath: "workspaces/nightmaker/projects/hook/card.png",
        workspace: "nightmaker",
        project: "hook",
        bucket: .image,
        modifiedAt: 15
    ),
    queryItem(
        id: "other-project",
        relativePath: "workspaces/daylight/projects/other/sound.mp3",
        workspace: "daylight",
        project: "other",
        bucket: .audio,
        modifiedAt: 25
    ),
]

private let queryAnnotations = [
    "workspaces/nightmaker/projects/hook/old.mp4": MediaAnnotation(verdict: .reject),
    "workspaces/nightmaker/projects/hook/new.mp4": MediaAnnotation(
        favorite: true,
        verdict: .reject
    ),
    "workspaces/nightmaker/projects/hook/card.png": MediaAnnotation(
        verdict: .keep,
        tags: ["Caf\u{00E9}"],
        note: "Use for the opener."
    ),
]

private func queryItem(
    id: String,
    relativePath: String,
    workspace: String,
    project: String,
    bucket: MediaBucket,
    modifiedAt: TimeInterval
) -> MediaItem {
    MediaItem(
        id: id,
        url: URL(filePath: "/tmp/\(relativePath)"),
        relativePath: relativePath,
        workspace: workspace,
        project: project,
        bucket: bucket,
        filename: URL(filePath: relativePath).lastPathComponent,
        fileExtension: URL(filePath: relativePath).pathExtension,
        sizeBytes: 1,
        createdAt: nil,
        modifiedAt: Date(timeIntervalSince1970: modifiedAt)
    )
}
