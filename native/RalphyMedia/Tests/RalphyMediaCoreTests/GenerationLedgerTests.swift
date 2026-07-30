import Foundation
import Testing
@testable import RalphyMediaCore

@Test func ledgerSumsSpendAndAttributesOutputsWithoutRetainingPayloads() async throws {
    let root = try TemporaryRalphy.make()
    let project = ProjectReference(workspaceID: "ws", projectID: "p")
    let marker = "payload-that-must-not-enter-the-cache"
    let payload = marker + String(repeating: "x", count: 256 * 1_024)
    try root.write(
        "\(project.relativePath)/logs/generations.jsonl",
        string: [
            generationLine(cost: 0.15, output: "artifacts/images/a.png", payload: payload),
            generationLine(cost: 0.20, output: "artifacts/voiceover/a.mp3"),
            "{malformed",
        ].joined(separator: "\n") + "\n"
    )
    let cache = root.url.appending(path: "cache")
    let spy = LedgerByteReaderSpy()
    let index = GenerationLedgerIndex(cacheDirectory: cache, byteReader: spy.reader)

    let summary = await index.summary(for: project, root: root.url)

    #expect(abs(summary.totalSpendUSD - 0.35) < 0.000_001)
    #expect(summary.attributions["artifacts/images/a.png"]?.costUSD == 0.15)
    #expect(summary.attributions["artifacts/voiceover/a.mp3"]?.provider == "test-provider")
    #expect(summary.malformedLineCount == 1)
    let files = try cacheFiles(in: cache)
    #expect(files.count == 1)
    #expect(spy.readCount > 1)
    #expect(spy.maximumRequestedByteCount <= GenerationLedgerByteReader.defaultChunkSize)
    let cacheData = try Data(contentsOf: #require(files.first))
    #expect(!cacheData.contains(Data(marker.utf8)))
}

@Test func ledgerKeepsLatestSuccessfulOutputAttributionAndLatestActivity() async throws {
    let root = try TemporaryRalphy.make()
    let project = ProjectReference(workspaceID: "ws", projectID: "p")
    try root.write(
        "\(project.relativePath)/logs/generations.jsonl",
        string: [
            generationLine(
                cost: 0.10,
                output: "artifacts/images/a.png",
                timestamp: "2026-07-30T08:00:00.000Z",
                model: "older"
            ),
            generationLine(
                cost: 0.30,
                output: "artifacts/images/a.png",
                timestamp: "2026-07-30T10:00:00.000Z",
                status: "error",
                model: "failed"
            ),
            generationLine(
                cost: 0.20,
                output: "artifacts/images/a.png",
                timestamp: "2026-07-30T09:00:00.000Z",
                model: "newer"
            ),
        ].joined(separator: "\n") + "\n"
    )

    let summary = await GenerationLedgerIndex(cacheDirectory: root.url.appending(path: "cache"))
        .summary(for: project, root: root.url)

    #expect(abs(summary.totalSpendUSD - 0.60) < 0.000_001)
    #expect(summary.attributions["artifacts/images/a.png"]?.model == "newer")
    #expect(summary.lastActivityAt == Date(timeIntervalSince1970: 1_785_405_600))
}

@Test func ledgerNormalizesProjectAbsoluteAndRelativeOutputPaths() async throws {
    let root = try TemporaryRalphy.make()
    let project = ProjectReference(workspaceID: "ws", projectID: "p")
    let projectURL = root.url.appending(path: project.relativePath)
    try root.write(
        "\(project.relativePath)/logs/generations.jsonl",
        string: [
            generationLine(cost: 0.10, output: projectURL.appending(path: "artifacts/images/a.png").path),
            generationLine(cost: 0.20, output: "\(project.relativePath)/artifacts/audio/a.mp3"),
            generationLine(cost: 0.30, output: "/tmp/outside.png"),
            generationLine(cost: 0.40, output: "../outside.png"),
        ].joined(separator: "\n") + "\n"
    )

    let summary = await GenerationLedgerIndex(cacheDirectory: root.url.appending(path: "cache"))
        .summary(for: project, root: root.url)

    #expect(summary.attributions.keys.sorted() == [
        "artifacts/audio/a.mp3",
        "artifacts/images/a.png",
    ])
    #expect(abs(summary.totalSpendUSD - 1.0) < 0.000_001)
}

@Test func ledgerResumesAtCachedCompleteLineOffset() async throws {
    let root = try TemporaryRalphy.make()
    let project = ProjectReference(workspaceID: "ws", projectID: "p")
    let logURL = root.url.appending(path: "\(project.relativePath)/logs/generations.jsonl")
    let initial = [
        generationLine(cost: 0.10, output: "artifacts/images/a.png"),
        generationLine(cost: 0.20, output: "artifacts/images/b.png"),
    ].joined(separator: "\n") + "\n"
    try root.write("\(project.relativePath)/logs/generations.jsonl", string: initial)
    let spy = LedgerByteReaderSpy()
    let firstIndex = GenerationLedgerIndex(
        cacheDirectory: root.url.appending(path: "cache"),
        byteReader: spy.reader
    )

    let first = await firstIndex.summary(for: project, root: root.url)
    try append(generationLine(cost: 0.30, output: "artifacts/images/c.png") + "\n", to: logURL)
    let resumedIndex = GenerationLedgerIndex(
        cacheDirectory: root.url.appending(path: "cache"),
        byteReader: spy.reader
    )
    let second = await resumedIndex.summary(for: project, root: root.url)
    let unchanged = await resumedIndex.summary(for: project, root: root.url)

    #expect(first.indexedByteOffset == UInt64(initial.utf8.count))
    #expect(spy.openOffsets.contains(UInt64(initial.utf8.count)))
    #expect(spy.maximumRequestedByteCount <= GenerationLedgerByteReader.defaultChunkSize)
    #expect(abs(second.totalSpendUSD - 0.60) < 0.000_001)
    #expect(unchanged.totalSpendUSD == second.totalSpendUSD)
}

@Test func ledgerRereadsOnlyAnIncompleteTailAfterAppend() async throws {
    let root = try TemporaryRalphy.make()
    let project = ProjectReference(workspaceID: "ws", projectID: "p")
    let complete = generationLine(cost: 0.10, output: "artifacts/images/a.png") + "\n"
    let third = generationLine(cost: 0.30, output: "artifacts/images/c.png")
    let split = third.index(third.startIndex, offsetBy: third.count / 2)
    try root.write(
        "\(project.relativePath)/logs/generations.jsonl",
        string: complete + third[..<split]
    )
    let spy = LedgerByteReaderSpy()
    let index = GenerationLedgerIndex(
        cacheDirectory: root.url.appending(path: "cache"),
        byteReader: spy.reader
    )

    let first = await index.summary(for: project, root: root.url)
    spy.reset()
    try append(
        String(third[split...]) + "\n",
        to: root.url.appending(path: "\(project.relativePath)/logs/generations.jsonl")
    )
    let second = await index.summary(for: project, root: root.url)

    #expect(first.indexedByteOffset == UInt64(complete.utf8.count))
    #expect(spy.openOffsets == [
        0,
        0,
        UInt64(complete.utf8.count),
        UInt64(complete.utf8.count),
        0,
    ])
    #expect(abs(second.totalSpendUSD - 0.40) < 0.000_001)
}

@Test func ledgerRebuildsAfterSourceTruncation() async throws {
    let root = try TemporaryRalphy.make()
    let project = ProjectReference(workspaceID: "ws", projectID: "p")
    let relativeLog = "\(project.relativePath)/logs/generations.jsonl"
    try root.write(
        relativeLog,
        string: [
            generationLine(cost: 0.10, output: "artifacts/images/a.png"),
            generationLine(cost: 0.20, output: "artifacts/images/b.png"),
        ].joined(separator: "\n") + "\n"
    )
    let spy = LedgerByteReaderSpy()
    let index = GenerationLedgerIndex(
        cacheDirectory: root.url.appending(path: "cache"),
        byteReader: spy.reader
    )
    _ = await index.summary(for: project, root: root.url)

    try replaceContents(
        of: root.url.appending(path: relativeLog),
        with: generationLine(cost: 0.40, output: "artifacts/images/rebuilt.png") + "\n"
    )
    let rebuilt = await index.summary(for: project, root: root.url)

    #expect(spy.openOffsets.last == 0)
    #expect(rebuilt.totalSpendUSD == 0.40)
    #expect(Array(rebuilt.attributions.keys) == ["artifacts/images/rebuilt.png"])
}

@Test func ledgerRebuildsAfterSameInodeTruncateAndRegrow() async throws {
    let root = try TemporaryRalphy.make()
    let project = ProjectReference(workspaceID: "ws", projectID: "p")
    let relativeLog = "\(project.relativePath)/logs/generations.jsonl"
    let logURL = root.url.appending(path: relativeLog)
    try root.write(
        relativeLog,
        string: generationLine(cost: 0.10, output: "artifacts/images/old.png") + "\n"
    )
    let originalFileNumber = try fileNumber(at: logURL)
    let spy = LedgerByteReaderSpy()
    let index = GenerationLedgerIndex(
        cacheDirectory: root.url.appending(path: "cache"),
        byteReader: spy.reader
    )
    _ = await index.summary(for: project, root: root.url)

    try replaceContents(
        of: logURL,
        with: [
            generationLine(cost: 0.40, output: "artifacts/images/rebuilt-a.png"),
            generationLine(cost: 0.50, output: "artifacts/images/rebuilt-b-with-a-longer-name.png"),
        ].joined(separator: "\n") + "\n"
    )
    let rebuilt = await index.summary(for: project, root: root.url)

    #expect(try fileNumber(at: logURL) == originalFileNumber)
    #expect(spy.openOffsets.last == 0)
    #expect(abs(rebuilt.totalSpendUSD - 0.90) < 0.000_001)
    #expect(rebuilt.attributions["artifacts/images/old.png"] == nil)
}

@Test func ledgerRebuildsAfterAtomicSourceReplacement() async throws {
    let root = try TemporaryRalphy.make()
    let project = ProjectReference(workspaceID: "ws", projectID: "p")
    let relativeLog = "\(project.relativePath)/logs/generations.jsonl"
    try root.write(
        relativeLog,
        string: generationLine(cost: 0.10, output: "artifacts/images/old.png") + "\n"
    )
    let spy = LedgerByteReaderSpy()
    let index = GenerationLedgerIndex(
        cacheDirectory: root.url.appending(path: "cache"),
        byteReader: spy.reader
    )
    _ = await index.summary(for: project, root: root.url)

    try root.write(
        relativeLog,
        string: generationLine(cost: 0.70, output: "artifacts/images/replacement-with-longer-name.png") + "\n"
    )
    let rebuilt = await index.summary(for: project, root: root.url)

    #expect(spy.openOffsets.last == 0)
    #expect(rebuilt.totalSpendUSD == 0.70)
    #expect(rebuilt.attributions["artifacts/images/old.png"] == nil)
}

@Test func ledgerRebuildsAfterCacheCorruption() async throws {
    let root = try TemporaryRalphy.make()
    let project = ProjectReference(workspaceID: "ws", projectID: "p")
    try root.write(
        "\(project.relativePath)/logs/generations.jsonl",
        string: generationLine(cost: 0.10, output: "artifacts/images/a.png") + "\n"
    )
    let cache = root.url.appending(path: "cache")
    let spy = LedgerByteReaderSpy()
    let index = GenerationLedgerIndex(cacheDirectory: cache, byteReader: spy.reader)
    _ = await index.summary(for: project, root: root.url)
    try Data("{broken".utf8).write(to: #require(try cacheFiles(in: cache).first), options: .atomic)

    let rebuilt = await index.summary(for: project, root: root.url)

    #expect(Set(spy.openOffsets) == [0])
    #expect(rebuilt.totalSpendUSD == 0.10)
}

@Test func ledgerRebuildsWhenCachedOffsetIsNotALineBoundary() async throws {
    let root = try TemporaryRalphy.make()
    let project = ProjectReference(workspaceID: "ws", projectID: "p")
    let relativeLog = "\(project.relativePath)/logs/generations.jsonl"
    let logURL = root.url.appending(path: relativeLog)
    let initial = generationLine(cost: 0.10, output: "artifacts/images/a.png") + "\n"
    try root.write(relativeLog, string: initial)
    let cache = root.url.appending(path: "cache")
    let spy = LedgerByteReaderSpy()
    let index = GenerationLedgerIndex(cacheDirectory: cache, byteReader: spy.reader)
    _ = await index.summary(for: project, root: root.url)
    try forgeCacheOffset(in: cache, source: Data(initial.utf8), offset: 5)
    spy.reset()

    try append(generationLine(cost: 0.20, output: "artifacts/images/b.png") + "\n", to: logURL)
    let rebuilt = await index.summary(for: project, root: root.url)

    #expect(spy.openOffsets == [0, 0, 0, 0])
    #expect(abs(rebuilt.totalSpendUSD - 0.30) < 0.000_001)
    #expect(rebuilt.malformedLineCount == 0)
}

@Test func ledgerRebuildsWhenCachedTailContainsACompleteLine() async throws {
    let root = try TemporaryRalphy.make()
    let project = ProjectReference(workspaceID: "ws", projectID: "p")
    let relativeLog = "\(project.relativePath)/logs/generations.jsonl"
    let logURL = root.url.appending(path: relativeLog)
    let first = generationLine(cost: 0.10, output: "artifacts/images/a.png") + "\n"
    let initial = first + generationLine(
        cost: 0.20,
        output: "artifacts/images/b.png"
    ) + "\n"
    try root.write(relativeLog, string: initial)
    let cache = root.url.appending(path: "cache")
    let spy = LedgerByteReaderSpy()
    let index = GenerationLedgerIndex(cacheDirectory: cache, byteReader: spy.reader)
    _ = await index.summary(for: project, root: root.url)
    try forgeCacheOffset(
        in: cache,
        source: Data(initial.utf8),
        offset: first.utf8.count
    )
    spy.reset()

    try append(generationLine(cost: 0.30, output: "artifacts/images/c.png") + "\n", to: logURL)
    let rebuilt = await index.summary(for: project, root: root.url)

    #expect(spy.openOffsets == [0, 0, UInt64(first.utf8.count), 0, 0])
    #expect(abs(rebuilt.totalSpendUSD - 0.60) < 0.000_001)
    #expect(rebuilt.malformedLineCount == 0)
}

@Test func ledgerRebuildsAfterSemanticallyInvalidCache() async throws {
    let root = try TemporaryRalphy.make()
    let project = ProjectReference(workspaceID: "ws", projectID: "p")
    try root.write(
        "\(project.relativePath)/logs/generations.jsonl",
        string: generationLine(cost: 0.10, output: "artifacts/images/a.png") + "\n"
    )
    let cache = root.url.appending(path: "cache")
    let spy = LedgerByteReaderSpy()
    let index = GenerationLedgerIndex(cacheDirectory: cache, byteReader: spy.reader)
    _ = await index.summary(for: project, root: root.url)

    let cacheURL = try #require(cacheFiles(in: cache).first)
    let data = try Data(contentsOf: cacheURL)
    var object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    object["indexedByteOffset"] = UInt64.max
    try JSONSerialization.data(withJSONObject: object).write(to: cacheURL, options: .atomic)

    let rebuilt = await index.summary(for: project, root: root.url)

    #expect(Set(spy.openOffsets) == [0])
    #expect(rebuilt.totalSpendUSD == 0.10)
}

@Test func ledgerCacheResumePreservesFractionalTimestampOrdering() async throws {
    let root = try TemporaryRalphy.make()
    let project = ProjectReference(workspaceID: "ws", projectID: "p")
    let relativeLog = "\(project.relativePath)/logs/generations.jsonl"
    let logURL = root.url.appending(path: relativeLog)
    try root.write(
        relativeLog,
        string: generationLine(
            cost: 0.10,
            output: "artifacts/images/a.png",
            timestamp: "2026-07-30T08:00:00.900Z",
            model: "newer"
        ) + "\n"
    )
    let cache = root.url.appending(path: "cache")
    _ = await GenerationLedgerIndex(cacheDirectory: cache)
        .summary(for: project, root: root.url)
    try append(
        generationLine(
            cost: 0.20,
            output: "artifacts/images/a.png",
            timestamp: "2026-07-30T08:00:00.500Z",
            model: "older"
        ) + "\n",
        to: logURL
    )

    let resumed = await GenerationLedgerIndex(cacheDirectory: cache)
        .summary(for: project, root: root.url)

    #expect(resumed.attributions["artifacts/images/a.png"]?.model == "newer")
    #expect(
        resumed.attributions["artifacts/images/a.png"]?.generatedAt?.timeIntervalSince1970 ==
            1_785_398_400.9
    )
}

@Test func ledgerInvalidationForcesAFullReread() async throws {
    let root = try TemporaryRalphy.make()
    let project = ProjectReference(workspaceID: "ws", projectID: "p")
    try root.write(
        "\(project.relativePath)/logs/generations.jsonl",
        string: generationLine(cost: 0.10, output: "artifacts/images/a.png") + "\n"
    )
    let spy = LedgerByteReaderSpy()
    let index = GenerationLedgerIndex(
        cacheDirectory: root.url.appending(path: "cache"),
        byteReader: spy.reader
    )
    _ = await index.summary(for: project, root: root.url)

    await index.invalidate(project)
    _ = await index.summary(for: project, root: root.url)

    #expect(Set(spy.openOffsets) == [0])
}

@Test func ledgerIgnoresNonFiniteAndNegativeCosts() async throws {
    let root = try TemporaryRalphy.make()
    let project = ProjectReference(workspaceID: "ws", projectID: "p")
    try root.write(
        "\(project.relativePath)/logs/generations.jsonl",
        string: [
            generationLine(cost: -1, output: "artifacts/images/negative.png"),
            #"{"timestamp":"2026-07-30T08:00:00Z","status":"ok","cost_usd":1e999}"#,
            generationLine(cost: 0.25, output: "artifacts/images/valid.png"),
        ].joined(separator: "\n") + "\n"
    )

    let summary = await GenerationLedgerIndex(cacheDirectory: root.url.appending(path: "cache"))
        .summary(for: project, root: root.url)

    #expect(summary.totalSpendUSD == 0.25)
    #expect(Array(summary.attributions.keys) == ["artifacts/images/valid.png"])
    #expect(summary.malformedLineCount == 1)
}

@Test func ledgerKeepsAggregateAndCacheFiniteWhenCostsOverflow() async throws {
    let root = try TemporaryRalphy.make()
    let project = ProjectReference(workspaceID: "ws", projectID: "p")
    try root.write(
        "\(project.relativePath)/logs/generations.jsonl",
        string: [
            generationLine(
                cost: Double.greatestFiniteMagnitude,
                output: "artifacts/images/a.png"
            ),
            generationLine(
                cost: Double.greatestFiniteMagnitude,
                output: "artifacts/images/b.png"
            ),
        ].joined(separator: "\n") + "\n"
    )
    let cache = root.url.appending(path: "cache")
    let first = await GenerationLedgerIndex(cacheDirectory: cache)
        .summary(for: project, root: root.url)
    let cached = await GenerationLedgerIndex(cacheDirectory: cache)
        .summary(for: project, root: root.url)

    #expect(first.totalSpendUSD == Double.greatestFiniteMagnitude)
    #expect(first.totalSpendUSD.isFinite)
    #expect(first.attributions["artifacts/images/b.png"]?.costUSD == Double.greatestFiniteMagnitude)
    #expect(cached.totalSpendUSD == first.totalSpendUSD)
    #expect(try cacheFiles(in: cache).count == 1)
}

@Test func ledgerCancellationDoesNotPublishPartialResultsOrCache() async throws {
    let root = try TemporaryRalphy.make()
    let project = ProjectReference(workspaceID: "ws", projectID: "p")
    let lines = (0..<2_000).map {
        generationLine(cost: 0.01, output: "artifacts/images/\($0).png")
    }.joined(separator: "\n") + "\n"
    try root.write("\(project.relativePath)/logs/generations.jsonl", string: lines)
    let cache = root.url.appending(path: "cache")
    let reader = GenerationLedgerByteReader.live.cancellingAfterFirstRead()
    let index = GenerationLedgerIndex(
        cacheDirectory: cache,
        byteReader: reader,
        chunkSize: 1_024
    )

    let summary = await index.summary(for: project, root: root.url)

    #expect(summary.totalSpendUSD == 0)
    #expect(summary.indexedByteOffset == 0)
    #expect((try? cacheFiles(in: cache))?.isEmpty != false)
}

private func generationLine(
    cost: Double,
    output: String,
    timestamp: String = "2026-07-30T08:00:00.000Z",
    status: String = "ok",
    model: String = "test-model",
    payload: String? = nil
) -> String {
    var object: [String: Any] = [
        "timestamp": timestamp,
        "provider": "test-provider",
        "model": model,
        "kind": "image",
        "cost_usd": cost,
        "status": status,
        "output": ["local": output],
    ]
    if let payload {
        object["input"] = ["prompt": payload, "base64": payload]
        object["response"] = payload
    }
    let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    return String(decoding: data, as: UTF8.self)
}

private func append(_ string: String, to url: URL) throws {
    let handle = try FileHandle(forWritingTo: url)
    defer { try? handle.close() }
    try handle.seekToEnd()
    try handle.write(contentsOf: Data(string.utf8))
}

private func replaceContents(of url: URL, with string: String) throws {
    let handle = try FileHandle(forWritingTo: url)
    defer { try? handle.close() }
    try handle.truncate(atOffset: 0)
    try handle.write(contentsOf: Data(string.utf8))
}

private func cacheFiles(in directory: URL) throws -> [URL] {
    guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
    return try FileManager.default.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: nil
    ).filter { $0.pathExtension == "json" }
}

private func mutateCache(
    in directory: URL,
    mutation: (inout [String: Any]) throws -> Void
) throws {
    let cacheURL = try #require(cacheFiles(in: directory).first)
    let data = try Data(contentsOf: cacheURL)
    var object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    try mutation(&object)
    try JSONSerialization.data(withJSONObject: object).write(to: cacheURL, options: .atomic)
}

private func forgeCacheOffset(
    in directory: URL,
    source: Data,
    offset: Int
) throws {
    try mutateCache(in: directory) { object in
        try #require((0...source.count).contains(offset))
        var witness = try #require(object["witness"] as? [String: Any])
        let prefixLength = min(4 * 1_024, source.count)
        let boundaryLength = min(4 * 1_024, offset)
        let boundaryStart = offset - boundaryLength
        let prefix = Data(source.prefix(prefixLength))
        let boundary = Data(source[boundaryStart..<offset])
        let tail = Data(source[offset..<source.count])

        object["indexedByteOffset"] = UInt64(offset)
        witness["prefixLength"] = UInt64(prefixLength)
        witness["prefixHash"] = testStableHash(prefix)
        witness["boundaryStart"] = UInt64(boundaryStart)
        witness["boundaryLength"] = UInt64(boundaryLength)
        witness["boundaryHash"] = testStableHash(boundary)
        witness["incompleteTailLength"] = UInt64(tail.count)
        witness["incompleteTailHash"] = testStableHash(tail)
        object["witness"] = witness
    }
}

private func testStableHash(_ data: Data) -> UInt64 {
    data.reduce(14_695_981_039_346_656_037) {
        ($0 ^ UInt64($1)) &* 1_099_511_628_211
    }
}

private func fileNumber(at url: URL) throws -> UInt64 {
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    return try #require((attributes[.systemFileNumber] as? NSNumber)?.uint64Value)
}

private final class LedgerByteReaderSpy: @unchecked Sendable {
    private let lock = NSLock()
    private var offsets: [UInt64] = []
    private var requestedByteCounts: [Int] = []

    var openOffsets: [UInt64] {
        lock.withLock { offsets }
    }

    var maximumRequestedByteCount: Int {
        lock.withLock { requestedByteCounts.max() ?? 0 }
    }

    var readCount: Int {
        lock.withLock { requestedByteCounts.count }
    }

    func reset() {
        lock.withLock {
            offsets.removeAll()
            requestedByteCounts.removeAll()
        }
    }

    var reader: GenerationLedgerByteReader {
        let live = GenerationLedgerByteReader.live
        return GenerationLedgerByteReader { [self] url, offset in
            lock.withLock { offsets.append(offset) }
            let stream = try live.open(url, offset)
            return GenerationLedgerByteStream(
                read: { [self] count in
                    lock.withLock { requestedByteCounts.append(count) }
                    return try stream.read(upToCount: count)
                },
                close: {
                    stream.close()
                }
            )
        }
    }
}

private extension GenerationLedgerByteReader {
    func cancellingAfterFirstRead() -> GenerationLedgerByteReader {
        GenerationLedgerByteReader { url, offset in
            let stream = try open(url, offset)
            return GenerationLedgerByteStream(
                read: { count in
                    let data = try stream.read(upToCount: count)
                    withUnsafeCurrentTask { $0?.cancel() }
                    return data
                },
                close: {
                    stream.close()
                }
            )
        }
    }
}
