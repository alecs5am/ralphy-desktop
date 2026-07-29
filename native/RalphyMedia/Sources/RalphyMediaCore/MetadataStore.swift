import Foundation

public enum MetadataStoreError: Error, Equatable, Sendable {
    case corruptFile(URL)
}

public struct MetadataStore: Sendable {
    public private(set) var root: URL
    public var annotations: [String: MediaAnnotation]

    private var fileURL: URL {
        root.appending(path: "media-library/library.json")
    }

    public init(root: URL) throws {
        let standardizedRoot = root.standardizedFileURL
        let metadataURL = standardizedRoot.appending(path: "media-library/library.json")
        self.root = standardizedRoot
        if FileManager.default.fileExists(atPath: metadataURL.path) {
            let data = try Data(contentsOf: metadataURL)
            do {
                self.annotations = try JSONDecoder.ralphy.decode(Payload.self, from: data).annotations
            } catch {
                throw MetadataStoreError.corruptFile(metadataURL)
            }
        } else {
            self.annotations = [:]
        }
    }

    public func save() throws {
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let data = try JSONEncoder.pretty.encode(Payload(annotations: annotations))
        try data.write(to: fileURL, options: [.atomic])
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
