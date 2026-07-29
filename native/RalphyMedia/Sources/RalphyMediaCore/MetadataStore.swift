import Foundation

public enum MetadataStoreError: Error, Equatable, Sendable {
    case corruptFile(URL)
    case conflict(URL)
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
            do {
                self.annotations = try JSONDecoder.ralphy.decode(Payload.self, from: data).annotations
                self.revision = .contents(data)
            } catch {
                throw MetadataStoreError.corruptFile(metadataURL)
            }
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
        do {
            _ = try JSONDecoder.ralphy.decode(Payload.self, from: data)
        } catch {
            throw MetadataStoreError.corruptFile(url)
        }
        return .contents(data)
    }
}

private struct Payload: Codable {
    let schemaVersion: Int
    var annotations: [String: MediaAnnotation]

    init(schemaVersion: Int = 1, annotations: [String: MediaAnnotation]) {
        self.schemaVersion = schemaVersion
        self.annotations = annotations
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case annotations
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        annotations = try container.decode([String: MediaAnnotation].self, forKey: .annotations)
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
