import Foundation
import RalphyMediaCore
import Testing
@testable import RalphyMediaApp

@Test
func routesChangesToOneProjectOrCatalog() {
    let root = URL(filePath: "/tmp/.ralphy")
    let changes = FolderChangeRouter.route(
        paths: [
            "/tmp/.ralphy/workspaces/ws/projects/p/artifacts/images/a.png",
            "/tmp/.ralphy/workspaces/ws/projects/q/logs/generations.jsonl",
        ],
        root: root
    )

    #expect(changes.projects == [
        ProjectReference(workspaceID: "ws", projectID: "p"),
        ProjectReference(workspaceID: "ws", projectID: "q"),
    ])
    #expect(!changes.catalogStructureChanged)
}

@Test
func routesWorkspaceAndProjectDirectoryChangesToTheCatalog() {
    let root = URL(filePath: "/tmp/.ralphy")
    let changes = FolderChangeRouter.route(
        paths: [
            "/tmp/.ralphy/workspaces/new-workspace",
            "/tmp/.ralphy/workspaces/ws/projects/new-project",
        ],
        root: root
    )

    #expect(changes.projects.isEmpty)
    #expect(changes.catalogStructureChanged)
}

@Test
func ignoresPathsOutsideTheRootAndAnnotationWrites() {
    let root = URL(filePath: "/tmp/.ralphy")
    let changes = FolderChangeRouter.route(
        paths: [
            "/tmp/.ralphy-other/workspaces/ws/projects/p/render/final.mp4",
            "/tmp/.ralphy/media-library/library.json",
        ],
        root: root
    )

    #expect(changes.projects.isEmpty)
    #expect(!changes.catalogStructureChanged)
}
