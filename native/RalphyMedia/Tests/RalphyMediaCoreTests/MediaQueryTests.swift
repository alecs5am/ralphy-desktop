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

@Test func queryFiltersEachProjectModeByEntityBeforeOtherFilters() {
    let items = [
        queryItem(id: "final", relativePath: "workspaces/ws/projects/p/render/final.mp4", workspace: "ws", project: "p", bucket: .video, modifiedAt: 1, entity: .finalRender),
        queryItem(id: "asset", relativePath: "workspaces/ws/projects/p/artifacts/images/asset.png", workspace: "ws", project: "p", bucket: .image, modifiedAt: 2, entity: .generatedAsset),
        queryItem(id: "ref", relativePath: "workspaces/ws/projects/p/artifacts/refs/ref.png", workspace: "ws", project: "p", bucket: .image, modifiedAt: 3, entity: .reference),
        queryItem(id: "unit", relativePath: "workspaces/ws/projects/p/units/ad-01/video.mp4", workspace: "ws", project: "p", bucket: .video, modifiedAt: 4, entity: .unit),
        queryItem(id: "file", relativePath: "workspaces/ws/projects/p/logs/run.log", workspace: "ws", project: "p", bucket: .text, modifiedAt: 5, entity: .productionFile),
        queryItem(id: "lifecycle", relativePath: "workspaces/ws/projects/p/BRIEF.md", workspace: "ws", project: "p", bucket: .text, modifiedAt: 6, entity: .lifecycleDocument),
    ]

    #expect(MediaQuery(mode: .overview).apply(to: items, annotations: [:]).map(\.id) == ["asset", "lifecycle", "final", "ref", "file", "unit"])
    #expect(MediaQuery(mode: .finals).apply(to: items, annotations: [:]).map(\.id) == ["final"])
    #expect(MediaQuery(mode: .assets).apply(to: items, annotations: [:]).map(\.id) == ["asset"])
    #expect(MediaQuery(mode: .refs).apply(to: items, annotations: [:]).map(\.id) == ["ref"])
    #expect(MediaQuery(mode: .units).apply(to: items, annotations: [:]).map(\.id) == ["unit"])
    #expect(MediaQuery(mode: .files).apply(to: items, annotations: [:]).map(\.id) == ["file"])
}

@Test func queryGroupsProjectItemsByEntityAndFirstProjectFolder() {
    let items = [
        queryItem(id: "asset", relativePath: "workspaces/ws/projects/p/artifacts/images/asset.png", workspace: "ws", project: "p", bucket: .image, modifiedAt: 1, entity: .generatedAsset),
        queryItem(id: "ref", relativePath: "workspaces/ws/projects/p/artifacts/refs/ref.png", workspace: "ws", project: "p", bucket: .image, modifiedAt: 2, entity: .reference),
        queryItem(id: "unit", relativePath: "workspaces/ws/projects/p/units/ad-01/video.mp4", workspace: "ws", project: "p", bucket: .video, modifiedAt: 3, entity: .unit),
    ]

    let entitySections = MediaQuery(group: .entity).sections(from: items, annotations: [:])
    let folderSections = MediaQuery(group: .folder).sections(from: items, annotations: [:])

    #expect(entitySections.map(\.title) == ["generatedAsset", "reference", "unit"])
    #expect(folderSections.map(\.title) == ["artifacts", "units"])
    #expect(folderSections[0].items.map(\.id) == ["asset", "ref"])
}

@Test func queryUsesRelativePathAsFinalSortTieBreaker() {
    let items = [
        queryItem(id: "b", relativePath: "b.mp4", workspace: "ws", project: "p", bucket: .video, modifiedAt: 1),
        queryItem(id: "a", relativePath: "a.mp4", workspace: "ws", project: "p", bucket: .video, modifiedAt: 1),
    ]

    let result = MediaQuery(sort: .newest).apply(to: items, annotations: [:])

    #expect(result.map(\.id) == ["a", "b"])
}

@Test func queryExcludesOnlyRejectedItemsWhenRequested() {
    let maybe = queryItem(
        id: "maybe",
        relativePath: "workspaces/nightmaker/projects/hook/maybe.mov",
        workspace: "nightmaker",
        project: "hook",
        bucket: .video,
        modifiedAt: 30
    )
    var annotations = queryAnnotations
    annotations[maybe.relativePath] = MediaAnnotation(verdict: .maybe)

    let result = MediaQuery(excludeRejected: true).apply(
        to: queryItems + [maybe],
        annotations: annotations
    )

    #expect(result.map(\.id) == ["tagged-image", "maybe", "other-project"])
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
    modifiedAt: TimeInterval,
    entity: RalphyEntityKind = .finalRender
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
        modifiedAt: Date(timeIntervalSince1970: modifiedAt),
        entity: entity
    )
}
