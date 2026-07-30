import Foundation
import Testing
@testable import RalphyMediaCore

@Test func metadataStorePersistsAnnotationsInsideRalphyRoot() throws {
    let root = try TemporaryRalphy.make()
    var store = try MetadataStore(root: root.url)
    let path = "workspaces/nightmaker/projects/hook/artifacts/videos/shot.mp4"

    store.annotations[path] = MediaAnnotation(
        rating: 5,
        favorite: true,
        rejected: false,
        tags: ["keeper"],
        note: "Use this as the agent reference.",
        updatedAt: Date(timeIntervalSince1970: 42)
    )
    try store.save()

    let loaded = try MetadataStore(root: root.url)
    #expect(loaded.annotations[path]?.rating == 5)
    #expect(loaded.annotations[path]?.favorite == true)
    #expect(loaded.annotations[path]?.rejected == false)
    #expect(loaded.annotations[path]?.tags == ["keeper"])
    #expect(loaded.annotations[path]?.note == "Use this as the agent reference.")
    #expect(FileManager.default.fileExists(atPath: root.url.appending(path: "media-library/library.json").path))
    let data = try Data(contentsOf: root.url.appending(path: "media-library/library.json"))
    let payload = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    #expect(payload["schemaVersion"] as? Int == 1)
}

@Test func metadataStorePreservesMalformedMetadataFile() throws {
    let root = try TemporaryRalphy.make()
    let fileURL = root.url.appending(path: "media-library/library.json")
    let original = Data("{ malformed".utf8)
    try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    try original.write(to: fileURL)

    do {
        _ = try MetadataStore(root: root.url)
        Issue.record("Expected corrupt metadata to fail")
    } catch let MetadataStoreError.corruptFile(url) {
        #expect(url == fileURL)
    }

    #expect(try Data(contentsOf: fileURL) == original)
}

@Test func metadataStoreRejectsExternalValidChangeAndPreservesIt() throws {
    let root = try TemporaryRalphy.make()
    let fileURL = root.url.appending(path: "media-library/library.json")
    let path = "workspaces/ws/projects/p/shot.mp4"
    var original = try MetadataStore(root: root.url)
    original.annotations[path] = MediaAnnotation(note: "original")
    try original.save()

    var stale = try MetadataStore(root: root.url)
    var external = try MetadataStore(root: root.url)
    external.annotations[path] = MediaAnnotation(note: "external")
    try external.save()
    let externalBytes = try Data(contentsOf: fileURL)
    stale.annotations[path] = MediaAnnotation(note: "stale overwrite")

    #expect(throws: MetadataStoreError.conflict(fileURL)) {
        try stale.save()
    }
    #expect(try Data(contentsOf: fileURL) == externalBytes)
}

@Test func metadataStoreRejectsLaterCorruptionAndPreservesIt() throws {
    let root = try TemporaryRalphy.make()
    let fileURL = root.url.appending(path: "media-library/library.json")
    var original = try MetadataStore(root: root.url)
    original.annotations["item"] = MediaAnnotation(note: "original")
    try original.save()

    var stale = try MetadataStore(root: root.url)
    let corruptBytes = Data("{ externally corrupted".utf8)
    try corruptBytes.write(to: fileURL)
    stale.annotations["item"] = MediaAnnotation(note: "stale overwrite")

    #expect(throws: MetadataStoreError.corruptFile(fileURL)) {
        try stale.save()
    }
    #expect(try Data(contentsOf: fileURL) == corruptBytes)
}

@Test func metadataStoreRejectsFutureSchemaWithoutRewritingUnknownData() throws {
    let root = try TemporaryRalphy.make()
    let fileURL = root.url.appending(path: "media-library/library.json")
    var stale = try MetadataStore(root: root.url)
    let futureBytes = Data(
        """
        {
          "schemaVersion": 2,
          "annotations": {},
          "futureSentinel": {"mustSurvive": true}
        }
        """.utf8
    )
    try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    try futureBytes.write(to: fileURL)

    #expect(throws: MetadataStoreError.unsupportedFutureSchema(fileURL, 2)) {
        _ = try MetadataStore(root: root.url)
    }

    stale.annotations["item"] = MediaAnnotation(note: "must not save")
    #expect(throws: MetadataStoreError.unsupportedFutureSchema(fileURL, 2)) {
        try stale.save()
    }
    #expect(try Data(contentsOf: fileURL) == futureBytes)
}

@Test func metadataStoreLoadsMissingSchemaAndLegacyRejectedAnnotation() throws {
    let root = try TemporaryRalphy.make()
    let fileURL = root.url.appending(path: "media-library/library.json")
    let legacyBytes = Data(
        """
        {
          "annotations": {
            "legacy.mp4": {
              "rating": 0,
              "favorite": false,
              "rejected": true,
              "tags": [],
              "note": "",
              "updatedAt": "1970-01-01T00:00:01Z"
            }
          }
        }
        """.utf8
    )
    try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    try legacyBytes.write(to: fileURL)

    let store = try MetadataStore(root: root.url)

    #expect(store.annotations["legacy.mp4"]?.verdict == .reject)
}
