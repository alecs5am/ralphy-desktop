import Foundation

struct TemporaryRalphy {
    let url: URL

    static func make() throws -> TemporaryRalphy {
        let url = URL(filePath: NSTemporaryDirectory())
            .appending(path: UUID().uuidString)
            .appending(path: ".ralphy")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return TemporaryRalphy(url: url)
    }

    func write(_ relativePath: String, bytes: [UInt8]) throws {
        let fileURL = url.appending(path: relativePath)
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(bytes).write(to: fileURL)
    }

    func write(_ relativePath: String, string: String) throws {
        let fileURL = url.appending(path: relativePath)
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try string.write(to: fileURL, atomically: true, encoding: .utf8)
    }
}
