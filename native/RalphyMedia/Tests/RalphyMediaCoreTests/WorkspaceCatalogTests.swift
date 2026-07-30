import Foundation
import Testing
@testable import RalphyMediaCore

@Test func catalogDiscoversRegisteredAndLegacyProjectsWithoutMediaTraversal() throws {
    let root = try TemporaryRalphy.make()
    try root.write("registry.json", string: registryFixture)
    try root.write("workspaces/nightmaker/workspace.json", string: workspaceFixture)
    try root.write("workspaces/nightmaker/projects/registered/render/final.mp4", bytes: [1])
    try root.write("workspaces/nightmaker/projects/legacy/artifacts/images/a.png", bytes: [1])

    let snapshot = try WorkspaceCatalogScanner().scan(root: root.url)

    #expect(snapshot.workspaces.map(\.id) == ["nightmaker"])
    #expect(snapshot.projects(in: "nightmaker").map(\.id.projectID) == ["registered", "legacy"])
    #expect(snapshot.projects(in: "nightmaker").first { $0.id.projectID == "registered" }?.hasFinalRender == true)
    #expect(snapshot.workspaces.first?.name == "Nightmaker")
    #expect(snapshot.projects(in: "nightmaker").first?.name == "Registered project")
}

@Test func catalogSortsByDerivedActivityAndDoesNotOpenAssetManifest() throws {
    let root = try TemporaryRalphy.make()
    let oldDate = Date(timeIntervalSince1970: 1)
    let newDate = Date(timeIntervalSince1970: 2)
    try root.write("workspaces/ws/projects/new/logs/generations.jsonl", bytes: [0])
    try root.write("workspaces/ws/projects/old/asset-manifest.json", string: "{not-json")
    try setModificationDate(oldDate, at: root.url.appending(path: "workspaces/ws/projects/old"))
    try setModificationDate(newDate, at: root.url.appending(path: "workspaces/ws/projects/new/logs/generations.jsonl"))

    let snapshot = try WorkspaceCatalogScanner().scan(root: root.url)

    #expect(snapshot.projects(in: "ws").map(\.id.projectID) == ["new", "old"])
    #expect(snapshot.warnings.isEmpty)
}

@Test func catalogEnumeratesOnlyWorkspaceAndProjectLevels() throws {
    let root = try TemporaryRalphy.make()
    try root.write("workspaces/ws/projects/project/artifacts/images/hidden.png", bytes: [1])
    try root.write("workspaces/ws/projects/project/render/final.mp4", bytes: [1])
    try root.write("workspaces/ws/projects/project/units/ad-01/video.mp4", bytes: [1])
    let recorder = DirectoryEnumerationRecorder()
    let live = CatalogFileSystem.live
    let fileSystem = CatalogFileSystem(
        directoryChildren: { url in
            recorder.record(url)
            return try live.directoryChildren(url)
        },
        metadata: live.metadata,
        readData: live.readData
    )

    _ = try WorkspaceCatalogScanner(fileSystem: fileSystem).scan(root: root.url)

    #expect(recorder.paths.allSatisfy { path in
        !path.contains("/projects/project/artifacts") &&
        !path.contains("/projects/project/render") &&
        !path.contains("/projects/project/units")
    })
}

@Test func catalogKeepsSiblingProjectsWhenARegistryFieldIsUnknown() throws {
    let root = try TemporaryRalphy.make()
    try root.write("registry.json", string: #"""
    {
      "projects": {
        "broken": { "id": "broken", "phase": "future-phase" },
        "registered": { "id": "registered", "name": "Registered project" }
      }
    }
    """#)
    try root.write("workspaces/ws/projects/broken/BRIEF.md", string: "Brief")
    try root.write("workspaces/ws/projects/registered/BRIEF.md", string: "Brief")

    let snapshot = try WorkspaceCatalogScanner().scan(root: root.url)

    #expect(snapshot.projects(in: "ws").first { $0.id.projectID == "registered" }?.name == "Registered project")
}

private let registryFixture = #"""
{
  "projects": {
    "registered": {
      "id": "registered",
      "name": "Registered project",
      "workspace": "nightmaker",
      "status": "rendering",
      "updatedAt": "2099-01-01T00:00:00Z"
    }
  }
}
"""#

private let workspaceFixture = #"""
{
  "name": "Nightmaker",
  "slug": "nightmaker",
  "description": "Workspace description"
}
"""#

private func setModificationDate(_ date: Date, at url: URL) throws {
    try FileManager.default.setAttributes([.modificationDate: date], ofItemAtPath: url.path)
}

private final class DirectoryEnumerationRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String] = []

    var paths: [String] {
        lock.withLock { values }
    }

    func record(_ url: URL) {
        lock.withLock { values.append(url.path) }
    }
}
