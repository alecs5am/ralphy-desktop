import Foundation
import Testing
@testable import RalphyMediaCore

@Test func metadataSaveCoordinatorPersistsNewestSubmittedSnapshotLast() async throws {
    let root = try TemporaryRalphy.make()
    let path = "workspaces/ws/projects/p/shot.mp4"
    let coordinator = MetadataSaveCoordinator { store in
        if store.annotations[path]?.note == "older" {
            try await Task.sleep(for: .milliseconds(50))
        }
        var saved = store
        try saved.save()
        return saved
    }
    var older = try MetadataStore(root: root.url)
    older.annotations[path] = MediaAnnotation(note: "older")
    var newest = older
    newest.annotations[path] = MediaAnnotation(note: "newest")

    let olderSave = await coordinator.submit(older)
    let newestSave = await coordinator.submit(newest)
    _ = try await olderSave.value
    _ = try await newestSave.value

    #expect(try MetadataStore(root: root.url).annotations[path]?.note == "newest")
}

@Test func metadataSaveCoordinatorUsesRevisionFromReopenedStore() async throws {
    let root = try TemporaryRalphy.make()
    let path = "workspaces/ws/projects/p/shot.mp4"
    let coordinator = MetadataSaveCoordinator()
    var first = try MetadataStore(root: root.url)
    first.annotations[path] = MediaAnnotation(note: "first")
    _ = try await coordinator.submit(first).value

    var external = try MetadataStore(root: root.url)
    external.annotations[path] = MediaAnnotation(note: "external")
    try external.save()
    var reopened = try MetadataStore(root: root.url)
    reopened.annotations[path] = MediaAnnotation(note: "reopened")

    _ = try await coordinator.submit(reopened).value

    #expect(try MetadataStore(root: root.url).annotations[path]?.note == "reopened")
}
