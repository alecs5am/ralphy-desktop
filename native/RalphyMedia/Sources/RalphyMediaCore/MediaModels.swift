import Foundation

public enum MediaBucket: String, Codable, CaseIterable, Hashable, Sendable {
    case image
    case video
    case audio
    case text
    case document
    case other
}

public struct ScanOptions: Sendable {
    public let includeIntermediates: Bool

    public init(includeIntermediates: Bool = false) {
        self.includeIntermediates = includeIntermediates
    }
}

public struct ScanResult: Sendable {
    public let items: [MediaItem]
    public let skipped: Int

    public init(items: [MediaItem], skipped: Int) {
        self.items = items
        self.skipped = skipped
    }
}

public struct MediaItem: Identifiable, Codable, Hashable, Sendable {
    public let id: String
    public let url: URL
    public let relativePath: String
    public let workspace: String
    public let project: String
    public let bucket: MediaBucket
    public let filename: String
    public let fileExtension: String
    public let sizeBytes: Int64
    public let createdAt: Date?
    public let modifiedAt: Date?

    public init(
        id: String,
        url: URL,
        relativePath: String,
        workspace: String,
        project: String,
        bucket: MediaBucket,
        filename: String,
        fileExtension: String,
        sizeBytes: Int64,
        createdAt: Date?,
        modifiedAt: Date?
    ) {
        self.id = id
        self.url = url
        self.relativePath = relativePath
        self.workspace = workspace
        self.project = project
        self.bucket = bucket
        self.filename = filename
        self.fileExtension = fileExtension
        self.sizeBytes = sizeBytes
        self.createdAt = createdAt
        self.modifiedAt = modifiedAt
    }
}

public enum ReviewVerdict: String, Codable, CaseIterable, Hashable, Sendable {
    case unreviewed
    case keep
    case maybe
    case reject
}

public struct MediaAnnotation: Codable, Equatable, Sendable {
    public var rating: Int {
        didSet { rating = max(0, min(5, rating)) }
    }
    public var favorite: Bool
    public var verdict: ReviewVerdict
    public var tags: [String] {
        didSet { tags = Self.normalizedTags(tags) }
    }
    public var note: String
    public var updatedAt: Date

    public init(
        rating: Int = 0,
        favorite: Bool = false,
        verdict: ReviewVerdict = .unreviewed,
        tags: [String] = [],
        note: String = "",
        updatedAt: Date = Date()
    ) {
        self.rating = max(0, min(5, rating))
        self.favorite = favorite
        self.verdict = verdict
        self.tags = Self.normalizedTags(tags)
        self.note = note
        self.updatedAt = updatedAt
    }

    public init(
        rating: Int = 0,
        favorite: Bool = false,
        rejected: Bool,
        tags: [String] = [],
        note: String = "",
        updatedAt: Date = Date()
    ) {
        self.init(
            rating: rating,
            favorite: favorite,
            verdict: rejected ? .reject : .unreviewed,
            tags: tags,
            note: note,
            updatedAt: updatedAt
        )
    }

    public var rejected: Bool {
        get { verdict == .reject }
        set {
            if newValue {
                verdict = .reject
            } else if verdict == .reject {
                verdict = .unreviewed
            }
        }
    }

    private enum CodingKeys: String, CodingKey {
        case rating
        case favorite
        case verdict
        case rejected
        case tags
        case note
        case updatedAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let legacyRejected = try container.decodeIfPresent(Bool.self, forKey: .rejected) ?? false
        self.init(
            rating: try container.decodeIfPresent(Int.self, forKey: .rating) ?? 0,
            favorite: try container.decodeIfPresent(Bool.self, forKey: .favorite) ?? false,
            verdict: try container.decodeIfPresent(ReviewVerdict.self, forKey: .verdict)
                ?? (legacyRejected ? .reject : .unreviewed),
            tags: try container.decodeIfPresent([String].self, forKey: .tags) ?? [],
            note: try container.decodeIfPresent(String.self, forKey: .note) ?? "",
            updatedAt: try container.decodeIfPresent(Date.self, forKey: .updatedAt) ?? Date(timeIntervalSince1970: 0)
        )
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(rating, forKey: .rating)
        try container.encode(favorite, forKey: .favorite)
        try container.encode(verdict, forKey: .verdict)
        try container.encode(tags, forKey: .tags)
        try container.encode(note, forKey: .note)
        try container.encode(updatedAt, forKey: .updatedAt)
    }

    private static func normalizedTags(_ tags: [String]) -> [String] {
        var seen = Set<String>()
        return tags.compactMap { tag in
            let normalized = tag.trimmingCharacters(in: .whitespacesAndNewlines)
                .precomposedStringWithCanonicalMapping
                .lowercased()
            return normalized.isEmpty || !seen.insert(normalized).inserted ? nil : normalized
        }
    }
}

extension JSONDecoder {
    static var ralphy: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
