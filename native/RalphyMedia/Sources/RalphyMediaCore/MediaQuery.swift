import Foundation

public enum MediaSort: String, CaseIterable, Hashable, Sendable {
    case name
    case newest
    case oldest
}

public enum MediaGroup: String, CaseIterable, Hashable, Sendable {
    case none
    case workspace
    case project
    case type
    case entity
    case folder
}

public enum ProjectMode: String, CaseIterable, Hashable, Sendable {
    case overview
    case finals
    case assets
    case refs
    case units
    case files
}

public struct MediaSection: Identifiable, Hashable, Sendable {
    public let id: String
    public let title: String
    public let items: [MediaItem]

    public init(id: String, title: String, items: [MediaItem]) {
        self.id = id
        self.title = title
        self.items = items
    }
}

public struct MediaQuery: Sendable {
    public var search: String?
    public var verdict: ReviewVerdict?
    public var excludeRejected: Bool
    public var favoriteOnly: Bool
    public var workspace: String?
    public var project: String?
    public var mode: ProjectMode
    public var bucket: MediaBucket?
    public var sort: MediaSort
    public var group: MediaGroup

    public init(
        search: String? = nil,
        verdict: ReviewVerdict? = nil,
        excludeRejected: Bool = false,
        favoriteOnly: Bool = false,
        workspace: String? = nil,
        project: String? = nil,
        mode: ProjectMode = .overview,
        bucket: MediaBucket? = nil,
        sort: MediaSort = .name,
        group: MediaGroup = .none
    ) {
        self.search = search
        self.verdict = verdict
        self.excludeRejected = excludeRejected
        self.favoriteOnly = favoriteOnly
        self.workspace = workspace
        self.project = project
        self.mode = mode
        self.bucket = bucket
        self.sort = sort
        self.group = group
    }

    public func apply(
        to items: [MediaItem],
        annotations: [String: MediaAnnotation]
    ) -> [MediaItem] {
        let search = normalized(search ?? "")
        let filtered = items.filter { item in
            let annotation = annotations[item.relativePath] ?? MediaAnnotation()
            guard mode.includes(item.entity) else { return false }
            guard verdict == nil || annotation.verdict == verdict else { return false }
            guard !excludeRejected || annotation.verdict != .reject else { return false }
            guard !favoriteOnly || annotation.favorite else { return false }
            guard workspace == nil || item.workspace == workspace else { return false }
            guard project == nil || item.project == project else { return false }
            guard bucket == nil || item.bucket == bucket else { return false }
            guard !search.isEmpty else { return true }

            return normalized([
                item.filename,
                item.relativePath,
                item.workspace,
                item.project,
                annotation.tags.joined(separator: " "),
                annotation.note,
            ].joined(separator: " ")).contains(search)
        }

        return filtered.enumerated().sorted { lhs, rhs in
            if ordered(lhs.element, before: rhs.element) { return true }
            if ordered(rhs.element, before: lhs.element) { return false }
            return lhs.offset < rhs.offset
        }.map(\.element)
    }

    public func sections(
        from items: [MediaItem],
        annotations: [String: MediaAnnotation]
    ) -> [MediaSection] {
        let items = apply(to: items, annotations: annotations)
        guard group != .none else {
            return [MediaSection(id: "all", title: "All", items: items)]
        }

        let grouped = Dictionary(grouping: items, by: groupTitle)
        return grouped.keys.sorted(by: localizedAscending).map { title in
            MediaSection(id: "\(group.rawValue):\(title)", title: title, items: grouped[title] ?? [])
        }
    }

    private func ordered(_ lhs: MediaItem, before rhs: MediaItem) -> Bool {
        switch sort {
        case .name:
            if lhs.filename != rhs.filename {
                return localizedAscending(lhs.filename, rhs.filename)
            }
        case .newest:
            if lhs.modifiedAt != rhs.modifiedAt {
                return (lhs.modifiedAt ?? .distantPast) > (rhs.modifiedAt ?? .distantPast)
            }
        case .oldest:
            if lhs.modifiedAt != rhs.modifiedAt {
                return (lhs.modifiedAt ?? .distantFuture) < (rhs.modifiedAt ?? .distantFuture)
            }
        }
        return lhs.relativePath < rhs.relativePath
    }

    private func groupTitle(for item: MediaItem) -> String {
        switch group {
        case .none: "All"
        case .workspace: item.workspace
        case .project: item.project
        case .type: item.bucket.rawValue
        case .entity: item.entity.rawValue
        case .folder: projectRelativeComponents(for: item).first.map(String.init) ?? "Project root"
        }
    }

    private func projectRelativeComponents(for item: MediaItem) -> [Substring] {
        let components = item.relativePath.split(separator: "/")
        guard components.count > 4,
              components[0] == "workspaces",
              components[1] == item.workspace,
              components[2] == "projects",
              components[3] == item.project else {
            return []
        }
        return Array(components.dropFirst(4))
    }
}

private extension ProjectMode {
    func includes(_ entity: RalphyEntityKind) -> Bool {
        switch self {
        case .overview: true
        case .finals: entity == .finalRender
        case .assets: entity == .generatedAsset
        case .refs: entity == .reference
        case .units: entity == .unit
        case .files: entity == .productionFile
        }
    }
}

private func normalized(_ value: String) -> String {
    value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
}

private func localizedAscending(_ lhs: String, _ rhs: String) -> Bool {
    lhs.localizedStandardCompare(rhs) == .orderedAscending
}
