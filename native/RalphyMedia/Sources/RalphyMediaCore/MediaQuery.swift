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
    public var favoriteOnly: Bool
    public var workspace: String?
    public var project: String?
    public var bucket: MediaBucket?
    public var sort: MediaSort
    public var group: MediaGroup

    public init(
        search: String? = nil,
        verdict: ReviewVerdict? = nil,
        favoriteOnly: Bool = false,
        workspace: String? = nil,
        project: String? = nil,
        bucket: MediaBucket? = nil,
        sort: MediaSort = .name,
        group: MediaGroup = .none
    ) {
        self.search = search
        self.verdict = verdict
        self.favoriteOnly = favoriteOnly
        self.workspace = workspace
        self.project = project
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
            guard verdict == nil || annotation.verdict == verdict else { return false }
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
        }
    }
}

private func normalized(_ value: String) -> String {
    value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
}

private func localizedAscending(_ lhs: String, _ rhs: String) -> Bool {
    lhs.localizedStandardCompare(rhs) == .orderedAscending
}
