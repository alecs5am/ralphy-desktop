import Foundation
import RalphyMediaCore

struct AppSettings {
    private enum Key {
        static let lastRoot = "lastRalphyRoot"
        static let gridSize = "mediaGridSize"
        static let bucket = "mediaBucket"
        static let sort = "mediaSort"
        static let group = "mediaGroup"
        static let workspace = "mediaWorkspace"
        static let project = "mediaProject"
        static let verdict = "mediaVerdict"
        static let favoriteOnly = "mediaFavoriteOnly"
        static let excludeRejected = "mediaExcludeRejected"
        static let includeIntermediates = "includeMediaIntermediates"
        static let inspectorVisible = "mediaInspectorVisible"
        static let selectedWorkspaceID = "selectedWorkspaceID"
        static let selectedProjectID = "selectedProjectID"
        static let projectMode = "projectMode"
        static let workspaceSort = "workspaceSort"
        static let pinnedWorkspaceIDs = "pinnedWorkspaceIDs"
        static let pinnedProjectIDs = "pinnedProjectIDs"
        static let sidebarWidth = "sidebarWidth"
        static let workspacePresentationSort = "workspacePresentationSort"
        static let projectPresentationSort = "projectPresentationSort"
    }

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var lastRoot: URL? {
        get {
            defaults.string(forKey: Key.lastRoot).map {
                URL(filePath: $0).standardizedFileURL
            }
        }
        nonmutating set {
            defaults.set(newValue?.standardizedFileURL.path, forKey: Key.lastRoot)
        }
    }

    var gridSize: Double {
        get {
            guard defaults.object(forKey: Key.gridSize) != nil else { return 180 }
            return min(320, max(120, defaults.double(forKey: Key.gridSize)))
        }
        nonmutating set {
            defaults.set(min(320, max(120, newValue)), forKey: Key.gridSize)
        }
    }

    var bucket: MediaBucket? {
        get {
            defaults.string(forKey: Key.bucket).flatMap(MediaBucket.init(rawValue:))
        }
        nonmutating set {
            defaults.set(newValue?.rawValue, forKey: Key.bucket)
        }
    }

    var sort: MediaSort {
        get {
            defaults.string(forKey: Key.sort).flatMap(MediaSort.init(rawValue:)) ?? .name
        }
        nonmutating set {
            defaults.set(newValue.rawValue, forKey: Key.sort)
        }
    }

    var group: MediaGroup {
        get {
            defaults.string(forKey: Key.group).flatMap(MediaGroup.init(rawValue:)) ?? .none
        }
        nonmutating set {
            defaults.set(newValue.rawValue, forKey: Key.group)
        }
    }

    var workspace: String? {
        get { defaults.string(forKey: Key.workspace) }
        nonmutating set { defaults.set(newValue, forKey: Key.workspace) }
    }

    var project: String? {
        get { defaults.string(forKey: Key.project) }
        nonmutating set { defaults.set(newValue, forKey: Key.project) }
    }

    var verdict: ReviewVerdict? {
        get {
            defaults.string(forKey: Key.verdict).flatMap(ReviewVerdict.init(rawValue:))
        }
        nonmutating set {
            defaults.set(newValue?.rawValue, forKey: Key.verdict)
        }
    }

    var favoriteOnly: Bool {
        get { defaults.bool(forKey: Key.favoriteOnly) }
        nonmutating set { defaults.set(newValue, forKey: Key.favoriteOnly) }
    }

    var excludeRejected: Bool {
        get { defaults.bool(forKey: Key.excludeRejected) }
        nonmutating set { defaults.set(newValue, forKey: Key.excludeRejected) }
    }

    var includeIntermediates: Bool {
        get { defaults.bool(forKey: Key.includeIntermediates) }
        nonmutating set { defaults.set(newValue, forKey: Key.includeIntermediates) }
    }

    var inspectorVisible: Bool {
        get {
            guard defaults.object(forKey: Key.inspectorVisible) != nil else { return true }
            return defaults.bool(forKey: Key.inspectorVisible)
        }
        nonmutating set {
            defaults.set(newValue, forKey: Key.inspectorVisible)
        }
    }

    var selectedWorkspaceID: String? {
        get { defaults.string(forKey: Key.selectedWorkspaceID) }
        nonmutating set { defaults.set(newValue, forKey: Key.selectedWorkspaceID) }
    }

    var selectedProjectID: String? {
        get { defaults.string(forKey: Key.selectedProjectID) }
        nonmutating set { defaults.set(newValue, forKey: Key.selectedProjectID) }
    }

    var projectMode: ProjectMode {
        get {
            defaults.string(forKey: Key.projectMode).flatMap(ProjectMode.init(rawValue:)) ?? .overview
        }
        nonmutating set { defaults.set(newValue.rawValue, forKey: Key.projectMode) }
    }

    var workspaceSort: MediaSort {
        get {
            defaults.string(forKey: Key.workspaceSort).flatMap(MediaSort.init(rawValue:)) ?? .name
        }
        nonmutating set { defaults.set(newValue.rawValue, forKey: Key.workspaceSort) }
    }

    var pinnedWorkspaceIDs: Set<String> {
        get { storedSet(forKey: Key.pinnedWorkspaceIDs) }
        nonmutating set { store(newValue, forKey: Key.pinnedWorkspaceIDs) }
    }

    var pinnedProjectIDs: Set<ProjectReference> {
        get { storedSet(forKey: Key.pinnedProjectIDs) }
        nonmutating set { store(newValue, forKey: Key.pinnedProjectIDs) }
    }

    var sidebarWidth: Double {
        get {
            guard defaults.object(forKey: Key.sidebarWidth) != nil else { return 280 }
            return defaults.double(forKey: Key.sidebarWidth)
        }
        nonmutating set { defaults.set(newValue, forKey: Key.sidebarWidth) }
    }

    var workspacePresentationSort: WorkspaceSortOption {
        get {
            defaults.string(forKey: Key.workspacePresentationSort)
                .flatMap(WorkspaceSortOption.init(rawValue:)) ?? .recent
        }
        nonmutating set {
            defaults.set(newValue.rawValue, forKey: Key.workspacePresentationSort)
        }
    }

    var projectPresentationSort: ProjectSortOption {
        get {
            defaults.string(forKey: Key.projectPresentationSort)
                .flatMap(ProjectSortOption.init(rawValue:)) ?? .recent
        }
        nonmutating set {
            defaults.set(newValue.rawValue, forKey: Key.projectPresentationSort)
        }
    }

    private func storedSet<Value: Decodable>(forKey key: String) -> Set<Value> {
        guard let data = defaults.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode(Set<Value>.self, from: data)) ?? []
    }

    private func store<Value: Encodable>(_ value: Set<Value>, forKey key: String) {
        defaults.set(try? JSONEncoder().encode(value), forKey: key)
    }
}
