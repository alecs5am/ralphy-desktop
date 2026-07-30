import Foundation

public enum MetadataStoreError: Error, Equatable, Sendable {
    case corruptFile(URL)
    case conflict(URL)
    case unsupportedFutureSchema(URL, Int)
}

public struct MetadataStore: Sendable {
    public private(set) var root: URL
    public var annotations: [String: MediaAnnotation]
    let sessionID: UUID
    private var revision: Revision

    private var fileURL: URL {
        root.appending(path: "media-library/library.json")
    }

    public init(root: URL) throws {
        let standardizedRoot = root.standardizedFileURL
        let metadataURL = standardizedRoot.appending(path: "media-library/library.json")
        self.root = standardizedRoot
        self.sessionID = UUID()
        if FileManager.default.fileExists(atPath: metadataURL.path) {
            let data = try Data(contentsOf: metadataURL)
            self.annotations = try decodePayload(from: data, at: metadataURL).annotations
            self.revision = .contents(data)
        } else {
            self.annotations = [:]
            self.revision = .missing
        }
    }

    public mutating func save() throws {
        let currentRevision = try Revision.read(from: fileURL)
        guard currentRevision == revision else {
            throw MetadataStoreError.conflict(fileURL)
        }
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let data = try JSONEncoder.pretty.encode(Payload(annotations: annotations))
        try data.write(to: fileURL, options: [.atomic])
        revision = .contents(data)
    }
}

extension MetadataStoreError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .corruptFile(let url):
            "Metadata is corrupt at \(url.path). Repair or move that file before saving annotations."
        case .conflict(let url):
            "Metadata changed outside Ralphy Media at \(url.path). Reopen the library before saving annotations."
        case .unsupportedFutureSchema(let url, let version):
            "Metadata at \(url.path) uses unsupported schema version \(version). Update Ralphy Media before saving annotations."
        }
    }
}

private enum Revision: Equatable, Sendable {
    case missing
    case contents(Data)

    static func read(from url: URL) throws -> Revision {
        guard FileManager.default.fileExists(atPath: url.path) else {
            return .missing
        }
        let data = try Data(contentsOf: url)
        _ = try decodePayload(from: data, at: url)
        return .contents(data)
    }
}

private struct Payload: Codable {
    static let currentSchemaVersion = 1

    let schemaVersion: Int
    var annotations: [String: MediaAnnotation]

    init(schemaVersion: Int = currentSchemaVersion, annotations: [String: MediaAnnotation]) {
        self.schemaVersion = schemaVersion
        self.annotations = annotations
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case annotations
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? Self.currentSchemaVersion
        guard schemaVersion <= Self.currentSchemaVersion else {
            throw UnsupportedFutureSchemaVersion(version: schemaVersion)
        }
        annotations = try container.decode([String: MediaAnnotation].self, forKey: .annotations)
    }
}

private struct UnsupportedFutureSchemaVersion: Error {
    let version: Int
}

private func decodePayload(from data: Data, at url: URL) throws -> Payload {
    do {
        return try JSONDecoder.ralphy.decode(Payload.self, from: data)
    } catch let error as UnsupportedFutureSchemaVersion {
        throw MetadataStoreError.unsupportedFutureSchema(url, error.version)
    } catch {
        throw MetadataStoreError.corruptFile(url)
    }
}

private extension JSONEncoder {
    static var pretty: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
