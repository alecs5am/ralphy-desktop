import RalphyMediaCore

enum WorkbenchRoute: Equatable, Sendable {
    case library
    case workspace(String)
    case project(ProjectReference)
    case asset(ProjectReference, String)
}

struct ProjectPresentationState: Sendable {
    var mode: ProjectMode
    var query: MediaQuery
    var selectedIDs: Set<String>
    var scrollAnchorID: String?

    init(
        mode: ProjectMode,
        query: MediaQuery,
        selectedIDs: Set<String>,
        scrollAnchorID: String?
    ) {
        self.mode = mode
        self.query = query
        self.selectedIDs = selectedIDs
        self.scrollAnchorID = scrollAnchorID
    }
}

struct WorkbenchNavigation: Sendable {
    private(set) var route: WorkbenchRoute = .library
    private(set) var projectPresentationStates: [ProjectReference: ProjectPresentationState] = [:]

    mutating func enterWorkspace(_ workspaceID: String) {
        route = .workspace(workspaceID)
    }

    mutating func enterProject(_ project: ProjectReference) {
        route = .project(project)
    }

    mutating func openAsset(id: String) {
        guard case let .project(project) = route else { return }
        route = .asset(project, id)
    }

    mutating func closeAsset() {
        guard case let .asset(project, _) = route else { return }
        route = .project(project)
    }

    @discardableResult
    mutating func goBack() -> WorkbenchRoute {
        switch route {
        case .library:
            break
        case .workspace:
            route = .library
        case let .project(project):
            route = .workspace(project.workspaceID)
        case let .asset(project, _):
            route = .project(project)
        }
        return route
    }

    func presentationState(for project: ProjectReference) -> ProjectPresentationState? {
        projectPresentationStates[project]
    }

    mutating func setPresentationState(_ state: ProjectPresentationState, for project: ProjectReference) {
        projectPresentationStates[project] = state
    }
}
