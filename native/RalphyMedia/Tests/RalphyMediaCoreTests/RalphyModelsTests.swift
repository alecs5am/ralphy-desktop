import Testing
@testable import RalphyMediaCore

@Test func projectReferenceBuildsCanonicalPaths() {
    let project = ProjectReference(workspaceID: "nightmaker", projectID: "relaunch-001")

    #expect(project.relativePath == "workspaces/nightmaker/projects/relaunch-001")
}
