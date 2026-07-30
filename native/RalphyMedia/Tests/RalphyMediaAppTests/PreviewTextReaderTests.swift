import Foundation
import Testing
@testable import RalphyMediaApp

@Test
func previewTextReaderBoundsReadsAndReportsTruncation() async throws {
    let url = FileManager.default.temporaryDirectory
        .appending(path: UUID().uuidString)
    try Data("abcdef".utf8).write(to: url)
    defer { try? FileManager.default.removeItem(at: url) }

    let preview = try await PreviewTextReader.read(url: url, byteLimit: 4)

    #expect(preview.text == "abcd")
    #expect(preview.isTruncated)
}

@Test
func previewTextReaderPropagatesCallerCancellation() async throws {
    let url = FileManager.default.temporaryDirectory
        .appending(path: UUID().uuidString)
    try Data("preview".utf8).write(to: url)
    defer { try? FileManager.default.removeItem(at: url) }

    let task = Task {
        withUnsafeCurrentTask { $0?.cancel() }
        return try await PreviewTextReader.read(url: url, byteLimit: 64)
    }

    await #expect(throws: CancellationError.self) {
        try await task.value
    }
}
