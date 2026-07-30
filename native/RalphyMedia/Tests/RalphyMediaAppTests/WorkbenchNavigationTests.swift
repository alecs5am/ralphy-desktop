import RalphyMediaCore
import Testing
@testable import RalphyMediaApp

@Test
func routeBackPopsAssetProjectWorkspaceInOrder() {
    let project = ProjectReference(workspaceID: "ws", projectID: "p")
    var navigation = WorkbenchNavigation()
    navigation.enterWorkspace("ws")
    navigation.enterProject(project)
    navigation.openAsset(id: "workspaces/ws/projects/p/render/final.mp4")

    #expect(navigation.goBack() == .project(project))
    #expect(navigation.goBack() == .workspace("ws"))
    #expect(navigation.goBack() == .library)
}

@Test
func projectPresentationStateRestoresGridContextAfterClosingAnAsset() {
    let project = ProjectReference(workspaceID: "ws", projectID: "p")
    let state = ProjectPresentationState(
        mode: .assets,
        query: MediaQuery(search: "hook", sort: .newest, group: .entity),
        selectedIDs: ["a"],
        scrollAnchorID: "a"
    )
    var navigation = WorkbenchNavigation()
    navigation.enterProject(project)
    navigation.setPresentationState(state, for: project)
    navigation.openAsset(id: "workspaces/ws/projects/p/render/final.mp4")
    navigation.closeAsset()

    #expect(navigation.route == .project(project))
    #expect(navigation.presentationState(for: project)?.scrollAnchorID == "a")
    #expect(navigation.presentationState(for: project)?.query.search == "hook")
}

@Test
func enteringWorkspaceClearsTheSelectedProjectRoute() {
    let project = ProjectReference(workspaceID: "ws", projectID: "p")
    var navigation = WorkbenchNavigation()
    navigation.enterProject(project)
    navigation.enterWorkspace("other")

    #expect(navigation.route == .workspace("other"))
}
