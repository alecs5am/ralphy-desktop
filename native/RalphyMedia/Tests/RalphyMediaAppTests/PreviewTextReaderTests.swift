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
