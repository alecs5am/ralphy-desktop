import Foundation

public struct GenerationLedgerSummary: Codable, Sendable {
    public let totalSpendUSD: Double
    public let lastActivityAt: Date?
    public let attributions: [String: GenerationAttribution]
    public let malformedLineCount: Int
    public let indexedByteOffset: UInt64

    static let empty = GenerationLedgerSummary(
        totalSpendUSD: 0,
        lastActivityAt: nil,
        attributions: [:],
        malformedLineCount: 0,
        indexedByteOffset: 0
    )
}

public actor GenerationLedgerIndex {
    private let cacheDirectory: URL
    private let byteReader: GenerationLedgerByteReader
    private let chunkSize: Int
    private let timestampParser = TimestampParser()

    public init(cacheDirectory: URL) {
        self.init(
            cacheDirectory: cacheDirectory,
            byteReader: .live,
            chunkSize: GenerationLedgerByteReader.defaultChunkSize
        )
    }

    init(
        cacheDirectory: URL,
        byteReader: GenerationLedgerByteReader,
        chunkSize: Int = GenerationLedgerByteReader.defaultChunkSize
    ) {
        self.cacheDirectory = cacheDirectory.standardizedFileURL
        self.byteReader = byteReader
        self.chunkSize = max(1, chunkSize)
    }

    public func summary(
        for project: ProjectReference,
        root: URL
    ) async -> GenerationLedgerSummary {
        guard !Task.isCancelled, project.hasSafePathComponents else {
            return .empty
        }

        let projectURL = root.standardizedFileURL.appending(path: project.relativePath)
        let sourceURL = projectURL.appending(path: "logs/generations.jsonl").standardizedFileURL
        let cacheURL = cacheFileURL(for: project)
        guard let source = SourceMetadata.read(from: sourceURL) else {
            try? FileManager.default.removeItem(at: cacheURL)
            return .empty
        }

        let cached = loadCache(at: cacheURL)
        let base: GenerationLedgerSummary
        let startOffset: UInt64
        if let cached,
           cached.matches(sourceURL: sourceURL, source: source),
           source.size >= cached.sourceSize,
           validateContinuity(of: cached, at: sourceURL) {
            if cached.sourceSize == source.size,
               cached.sourceModificationTime == source.modificationTime {
                return cached.summary
            }
            if source.size > cached.sourceSize,
               cached.indexedByteOffset <= cached.sourceSize {
                base = cached.summary
                startOffset = cached.indexedByteOffset
            } else {
                base = .empty
                startOffset = 0
            }
        } else {
            base = .empty
            startOffset = 0
        }

        let fallback = base
        guard let indexed = index(
            sourceURL: sourceURL,
            project: project,
            projectURL: projectURL,
            sourceSize: source.size,
            startOffset: startOffset,
            base: base
        ) else {
            return fallback
        }
        guard !Task.isCancelled,
              let currentSource = SourceMetadata.read(from: sourceURL),
              currentSource.sameFile(as: source),
              currentSource.size >= source.size,
              currentSource.size > source.size ||
                currentSource.modificationTime == source.modificationTime else {
            return fallback
        }
        guard let witness = makeContinuityWitness(
            for: sourceURL,
            sourceSize: source.size,
            indexedByteOffset: indexed.indexedByteOffset
        ) else {
            return indexed
        }

        let payload = GenerationLedgerCache(
            sourcePath: sourceURL.path,
            sourceSize: source.size,
            sourceModificationTime: source.modificationTime,
            sourceDevice: source.device,
            sourceFileNumber: source.fileNumber,
            witness: witness,
            summary: indexed
        )
        persist(payload, at: cacheURL)
        return indexed
    }

    public func invalidate(_ project: ProjectReference) {
        try? FileManager.default.removeItem(at: cacheFileURL(for: project))
    }

    private func index(
        sourceURL: URL,
        project: ProjectReference,
        projectURL: URL,
        sourceSize: UInt64,
        startOffset: UInt64,
        base: GenerationLedgerSummary
    ) -> GenerationLedgerSummary? {
        guard startOffset <= sourceSize else { return nil }

        let stream: GenerationLedgerByteStream
        do {
            stream = try byteReader.open(sourceURL, startOffset)
        } catch {
            return nil
        }
        defer { stream.close() }

        var accumulator = LedgerAccumulator(base)
        var pending = Data()
        var readOffset = startOffset
        var searchedByteCount = 0

        while readOffset < sourceSize {
            guard !Task.isCancelled else { return nil }
            let count = min(chunkSize, Int(sourceSize - readOffset))
            let chunk: Data
            do {
                chunk = try stream.read(upToCount: count) ?? Data()
            } catch {
                return nil
            }
            guard !chunk.isEmpty, !Task.isCancelled else { return nil }
            readOffset += UInt64(chunk.count)
            pending.append(chunk)
            consumeCompleteLines(
                from: &pending,
                project: project,
                projectURL: projectURL,
                accumulator: &accumulator,
                searchedByteCount: &searchedByteCount
            )
        }

        guard readOffset == sourceSize else { return nil }
        return accumulator.summary
    }

    private func consumeCompleteLines(
        from pending: inout Data,
        project: ProjectReference,
        projectURL: URL,
        accumulator: inout LedgerAccumulator,
        searchedByteCount: inout Int
    ) {
        precondition(searchedByteCount <= pending.count)
        var consumed = pending.startIndex
        var search = pending.index(pending.startIndex, offsetBy: searchedByteCount)
        while search < pending.endIndex,
              let newline = pending[search...].firstIndex(of: 0x0A) {
            var line = Data(pending[consumed..<newline])
            if line.last == 0x0D {
                line.removeLast()
            }
            accumulator.indexedByteOffset += UInt64(newline - consumed + 1)
            autoreleasepool {
                accumulator.consume(
                    line,
                    project: project,
                    projectURL: projectURL,
                    timestampParser: timestampParser
                )
            }
            consumed = newline + 1
            search = consumed
        }
        if consumed > pending.startIndex {
            pending.removeSubrange(pending.startIndex..<consumed)
        }
        // All remaining bytes were searched once and contain no newline.
        searchedByteCount = pending.count
    }

    private func loadCache(at url: URL) -> GenerationLedgerCache? {
        guard let data = try? Data(contentsOf: url),
              let cache = try? JSONDecoder.generationLedger.decode(
                GenerationLedgerCache.self,
                from: data
              ),
              cache.isValid else {
            return nil
        }
        return cache
    }

    private func makeContinuityWitness(
        for url: URL,
        sourceSize: UInt64,
        indexedByteOffset: UInt64
    ) -> SourceContinuityWitness? {
        guard indexedByteOffset <= sourceSize else { return nil }
        let prefixLength = min(SourceContinuityWitness.maximumBoundedBytes, sourceSize)
        let boundaryLength = min(
            SourceContinuityWitness.maximumBoundedBytes,
            indexedByteOffset
        )
        let boundaryStart = indexedByteOffset - boundaryLength
        guard let prefix = readData(
            from: url,
            offset: 0,
            length: prefixLength
        ) else {
            return nil
        }
        let boundary: Data
        if boundaryStart == 0, boundaryLength == prefixLength {
            boundary = prefix
        } else {
            guard let data = readData(
                from: url,
                offset: boundaryStart,
                length: boundaryLength
            ) else {
                return nil
            }
            boundary = data
        }
        guard indexedByteOffset == 0 || boundary.last == 0x0A else { return nil }

        let incompleteTailLength = sourceSize - indexedByteOffset
        guard let incompleteTailHash = hashRange(
            in: url,
            offset: indexedByteOffset,
            length: incompleteTailLength,
            rejectingNewlines: true
        ) else {
            return nil
        }
        return SourceContinuityWitness(
            prefixLength: prefixLength,
            prefixHash: stableHash(prefix),
            boundaryStart: boundaryStart,
            boundaryLength: boundaryLength,
            boundaryHash: stableHash(boundary),
            incompleteTailLength: incompleteTailLength,
            incompleteTailHash: incompleteTailHash
        )
    }

    private func validateContinuity(
        of cache: GenerationLedgerCache,
        at url: URL
    ) -> Bool {
        guard !Task.isCancelled,
              let prefix = readData(
                from: url,
                offset: 0,
                length: cache.witness.prefixLength
              ),
              stableHash(prefix) == cache.witness.prefixHash else {
            return false
        }

        let boundary: Data
        if cache.witness.boundaryStart == 0,
           cache.witness.boundaryLength == cache.witness.prefixLength {
            boundary = prefix
        } else {
            guard let data = readData(
                from: url,
                offset: cache.witness.boundaryStart,
                length: cache.witness.boundaryLength
            ) else {
                return false
            }
            boundary = data
        }
        guard cache.indexedByteOffset == 0 || boundary.last == 0x0A,
              stableHash(boundary) == cache.witness.boundaryHash,
              let tailHash = hashRange(
                in: url,
                offset: cache.indexedByteOffset,
                length: cache.witness.incompleteTailLength,
                rejectingNewlines: true
              ),
              tailHash == cache.witness.incompleteTailHash else {
            return false
        }
        return true
    }

    private func readData(
        from url: URL,
        offset: UInt64,
        length: UInt64
    ) -> Data? {
        guard length <= UInt64(Int.max) else { return nil }
        if length == 0 { return Data() }
        let stream: GenerationLedgerByteStream
        do {
            stream = try byteReader.open(url, offset)
        } catch {
            return nil
        }
        defer { stream.close() }

        var result = Data()
        result.reserveCapacity(Int(length))
        while result.count < Int(length) {
            guard !Task.isCancelled else { return nil }
            let count = min(chunkSize, Int(length) - result.count)
            guard let chunk = try? stream.read(upToCount: count),
                  !chunk.isEmpty else {
                return nil
            }
            result.append(chunk)
        }
        return result
    }

    private func hashRange(
        in url: URL,
        offset: UInt64,
        length: UInt64,
        rejectingNewlines: Bool
    ) -> UInt64? {
        if length == 0 { return StableByteHasher.offsetBasis }
        let stream: GenerationLedgerByteStream
        do {
            stream = try byteReader.open(url, offset)
        } catch {
            return nil
        }
        defer { stream.close() }

        var remaining = length
        var hasher = StableByteHasher()
        while remaining > 0 {
            guard !Task.isCancelled else { return nil }
            let count = min(chunkSize, Int(remaining))
            guard let chunk = try? stream.read(upToCount: count),
                  !chunk.isEmpty,
                  UInt64(chunk.count) <= remaining,
                  !rejectingNewlines || !chunk.contains(0x0A) else {
                return nil
            }
            hasher.update(chunk)
            remaining -= UInt64(chunk.count)
        }
        return hasher.value
    }

    private func persist(_ cache: GenerationLedgerCache, at url: URL) {
        guard !Task.isCancelled,
              let data = try? JSONEncoder.generationLedger.encode(cache) else {
            return
        }
        do {
            try FileManager.default.createDirectory(
                at: cacheDirectory,
                withIntermediateDirectories: true
            )
            guard !Task.isCancelled else { return }
            try data.write(to: url, options: .atomic)
        } catch {
            return
        }
    }

    private func cacheFileURL(for project: ProjectReference) -> URL {
        let key = "\(project.workspaceID)\u{0}\(project.projectID)"
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in key.utf8 {
            hash = (hash ^ UInt64(byte)) &* 1_099_511_628_211
        }
        return cacheDirectory.appending(
            path: "generation-ledger-\(String(format: "%016llx", hash)).json"
        )
    }
}

struct GenerationLedgerByteReader: @unchecked Sendable {
    static let defaultChunkSize = 64 * 1_024

    let open: (URL, UInt64) throws -> GenerationLedgerByteStream

    init(open: @escaping (URL, UInt64) throws -> GenerationLedgerByteStream) {
        self.open = open
    }

    static let live = GenerationLedgerByteReader { url, offset in
        let handle = try FileHandle(forReadingFrom: url)
        do {
            try handle.seek(toOffset: offset)
        } catch {
            try? handle.close()
            throw error
        }
        return GenerationLedgerByteStream(
            read: { count in
                try handle.read(upToCount: count)
            },
            close: {
                try? handle.close()
            }
        )
    }
}

final class GenerationLedgerByteStream: @unchecked Sendable {
    private let readBytes: (Int) throws -> Data?
    private let closeStream: () -> Void

    init(
        read: @escaping (Int) throws -> Data?,
        close: @escaping () -> Void
    ) {
        self.readBytes = read
        self.closeStream = close
    }

    func read(upToCount count: Int) throws -> Data? {
        try readBytes(count)
    }

    func close() {
        closeStream()
    }
}

private struct GenerationLedgerCache: Codable {
    static let currentSchemaVersion = 2

    let schemaVersion: Int
    let sourcePath: String
    let sourceSize: UInt64
    let sourceModificationTime: TimeInterval
    let sourceDevice: UInt64
    let sourceFileNumber: UInt64
    let witness: SourceContinuityWitness
    let totalSpendUSD: Double
    let lastActivityAt: Date?
    let attributions: [String: GenerationAttribution]
    let malformedLineCount: Int
    let indexedByteOffset: UInt64

    init(
        sourcePath: String,
        sourceSize: UInt64,
        sourceModificationTime: TimeInterval,
        sourceDevice: UInt64,
        sourceFileNumber: UInt64,
        witness: SourceContinuityWitness,
        summary: GenerationLedgerSummary
    ) {
        self.schemaVersion = Self.currentSchemaVersion
        self.sourcePath = sourcePath
        self.sourceSize = sourceSize
        self.sourceModificationTime = sourceModificationTime
        self.sourceDevice = sourceDevice
        self.sourceFileNumber = sourceFileNumber
        self.witness = witness
        self.totalSpendUSD = summary.totalSpendUSD
        self.lastActivityAt = summary.lastActivityAt
        self.attributions = summary.attributions
        self.malformedLineCount = summary.malformedLineCount
        self.indexedByteOffset = summary.indexedByteOffset
    }

    var summary: GenerationLedgerSummary {
        GenerationLedgerSummary(
            totalSpendUSD: totalSpendUSD,
            lastActivityAt: lastActivityAt,
            attributions: attributions,
            malformedLineCount: malformedLineCount,
            indexedByteOffset: indexedByteOffset
        )
    }

    var isValid: Bool {
        schemaVersion == Self.currentSchemaVersion &&
            !sourcePath.isEmpty &&
            sourceModificationTime.isFinite &&
            indexedByteOffset <= sourceSize &&
            witness.isValid(
                sourceSize: sourceSize,
                indexedByteOffset: indexedByteOffset
            ) &&
            totalSpendUSD.isFinite &&
            totalSpendUSD >= 0 &&
            malformedLineCount >= 0 &&
            attributions.values.allSatisfy {
                $0.costUSD.isFinite && $0.costUSD >= 0
            }
    }

    func matches(sourceURL: URL, source: SourceMetadata) -> Bool {
        sourcePath == sourceURL.path &&
            sourceDevice == source.device &&
            sourceFileNumber == source.fileNumber
    }
}

private struct SourceContinuityWitness: Codable {
    static let maximumBoundedBytes: UInt64 = 4 * 1_024

    let prefixLength: UInt64
    let prefixHash: UInt64
    let boundaryStart: UInt64
    let boundaryLength: UInt64
    let boundaryHash: UInt64
    let incompleteTailLength: UInt64
    let incompleteTailHash: UInt64

    func isValid(sourceSize: UInt64, indexedByteOffset: UInt64) -> Bool {
        prefixLength == min(Self.maximumBoundedBytes, sourceSize) &&
            boundaryLength == min(Self.maximumBoundedBytes, indexedByteOffset) &&
            boundaryStart == indexedByteOffset - boundaryLength &&
            incompleteTailLength == sourceSize - indexedByteOffset
    }
}

private struct StableByteHasher {
    static let offsetBasis: UInt64 = 14_695_981_039_346_656_037
    private(set) var value = offsetBasis

    mutating func update(_ data: Data) {
        for byte in data {
            value = (value ^ UInt64(byte)) &* 1_099_511_628_211
        }
    }
}

private func stableHash(_ data: Data) -> UInt64 {
    var hasher = StableByteHasher()
    hasher.update(data)
    return hasher.value
}

private struct SourceMetadata {
    let size: UInt64
    let modificationTime: TimeInterval
    let device: UInt64
    let fileNumber: UInt64

    static func read(from url: URL) -> SourceMetadata? {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = (attributes[.size] as? NSNumber)?.uint64Value,
              let modificationDate = attributes[.modificationDate] as? Date,
              let device = (attributes[.systemNumber] as? NSNumber)?.uint64Value,
              let fileNumber = (attributes[.systemFileNumber] as? NSNumber)?.uint64Value else {
            return nil
        }
        return SourceMetadata(
            size: size,
            modificationTime: modificationDate.timeIntervalSince1970,
            device: device,
            fileNumber: fileNumber
        )
    }

    func sameFile(as other: SourceMetadata) -> Bool {
        device == other.device && fileNumber == other.fileNumber
    }
}

private struct LedgerAccumulator {
    var totalSpendUSD: Double
    var lastActivityAt: Date?
    var attributions: [String: GenerationAttribution]
    var malformedLineCount: Int
    var indexedByteOffset: UInt64

    init(_ summary: GenerationLedgerSummary) {
        totalSpendUSD = summary.totalSpendUSD
        lastActivityAt = summary.lastActivityAt
        attributions = summary.attributions
        malformedLineCount = summary.malformedLineCount
        indexedByteOffset = summary.indexedByteOffset
    }

    mutating func consume(
        _ data: Data,
        project: ProjectReference,
        projectURL: URL,
        timestampParser: TimestampParser
    ) {
        guard let record = try? JSONDecoder().decode(GenerationRecord.self, from: data) else {
            malformedLineCount += 1
            return
        }

        let timestamp = record.timestamp.flatMap(timestampParser.parse)
        if let timestamp, timestamp > (lastActivityAt ?? .distantPast) {
            lastActivityAt = timestamp
        }

        guard let cost = record.costUSD, cost.isFinite, cost >= 0 else { return }
        let candidateTotal = totalSpendUSD + cost
        if candidateTotal.isFinite {
            totalSpendUSD = candidateTotal
        }
        guard record.status == nil || record.status == "ok",
              let output = record.output?.local,
              let path = normalizedOutputPath(
                output,
                project: project,
                projectURL: projectURL
              ) else {
            return
        }

        let attribution = GenerationAttribution(
            costUSD: cost,
            provider: record.provider,
            model: record.model,
            generatedAt: timestamp
        )
        if shouldReplace(attributions[path], with: attribution) {
            attributions[path] = attribution
        }
    }

    var summary: GenerationLedgerSummary {
        GenerationLedgerSummary(
            totalSpendUSD: totalSpendUSD,
            lastActivityAt: lastActivityAt,
            attributions: attributions,
            malformedLineCount: malformedLineCount,
            indexedByteOffset: indexedByteOffset
        )
    }

    private func shouldReplace(
        _ current: GenerationAttribution?,
        with candidate: GenerationAttribution
    ) -> Bool {
        guard let current else { return true }
        return switch (current.generatedAt, candidate.generatedAt) {
        case (_, .some) where current.generatedAt == nil:
            true
        case let (.some(old), .some(new)):
            new >= old
        case (nil, nil):
            true
        default:
            false
        }
    }

    private func normalizedOutputPath(
        _ path: String,
        project: ProjectReference,
        projectURL: URL
    ) -> String? {
        if path.hasPrefix("/") {
            let absolute = URL(filePath: path).standardizedFileURL.path
            let projectPath = projectURL.standardizedFileURL.path
            guard absolute.hasPrefix(projectPath + "/") else { return nil }
            return normalizedRelativePath(String(absolute.dropFirst(projectPath.count + 1)))
        }

        guard var normalized = normalizedRelativePath(path) else { return nil }
        let prefix = project.relativePath + "/"
        if normalized.hasPrefix(prefix) {
            normalized = String(normalized.dropFirst(prefix.count))
        }
        return normalizedRelativePath(normalized)
    }

    private func normalizedRelativePath(_ path: String) -> String? {
        var components: [Substring] = []
        for component in path.split(separator: "/", omittingEmptySubsequences: true) {
            switch component {
            case ".":
                continue
            case "..":
                return nil
            default:
                components.append(component)
            }
        }
        return components.isEmpty ? nil : components.joined(separator: "/")
    }
}

private struct GenerationRecord: Decodable {
    struct Output: Decodable {
        let local: String?
    }

    let timestamp: String?
    let provider: String?
    let model: String?
    let kind: String?
    let costUSD: Double?
    let status: String?
    let output: Output?

    enum CodingKeys: String, CodingKey {
        case timestamp
        case provider
        case model
        case kind
        case costUSD = "cost_usd"
        case status
        case output
    }
}

private final class TimestampParser {
    private let fractional: ISO8601DateFormatter
    private let standard = ISO8601DateFormatter()

    init() {
        fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    }

    func parse(_ value: String) -> Date? {
        fractional.date(from: value) ?? standard.date(from: value)
    }
}

private extension ProjectReference {
    var hasSafePathComponents: Bool {
        [workspaceID, projectID].allSatisfy {
            !$0.isEmpty &&
                $0 != "." &&
                $0 != ".." &&
                !$0.contains("/") &&
                !$0.contains("\\")
        }
    }
}

private extension JSONEncoder {
    static var generationLedger: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }
}

private extension JSONDecoder {
    static var generationLedger: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return decoder
    }
}
