import AppKit
import AVKit
import PDFKit
import RalphyMediaCore
import SwiftUI

struct PreviewIdentity: Hashable, Sendable {
    let id: String
    let modifiedAt: Date?
    let sizeBytes: Int64

    init(item: MediaItem) {
        id = item.id
        modifiedAt = item.modifiedAt
        sizeBytes = item.sizeBytes
    }
}

struct PreviewTextContent: Sendable {
    let text: String
    let isTruncated: Bool
}

enum PreviewTextReader {
    static func read(url: URL, byteLimit: Int) async throws -> PreviewTextContent {
        try await PreviewLoader().loadText(url: url, byteLimit: byteLimit)
    }
}

struct LoadedPDF: @unchecked Sendable {
    let value: PDFDocument
}

actor PreviewLoader {
    private static let chunkSize = 64 * 1_024

    func loadText(url: URL, byteLimit: Int) throws -> PreviewTextContent {
        let limit = max(0, byteLimit)
        let readLimit = limit == Int.max ? Int.max : limit + 1
        let data = try readData(url: url, byteLimit: readLimit)
        return PreviewTextContent(
            text: String(decoding: data.prefix(limit), as: UTF8.self),
            isTruncated: data.count > limit
        )
    }

    func loadPDF(url: URL) throws -> LoadedPDF {
        let data = try readData(url: url)
        try Task.checkCancellation()
        guard let document = PDFDocument(data: data) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        try Task.checkCancellation()
        return LoadedPDF(value: document)
    }

    private func readData(url: URL, byteLimit: Int? = nil) throws -> Data {
        try Task.checkCancellation()
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }

        var data = Data()
        while byteLimit.map({ data.count < $0 }) ?? true {
            try Task.checkCancellation()
            let remaining = byteLimit.map { $0 - data.count } ?? Self.chunkSize
            let readCount = min(Self.chunkSize, remaining)
            guard readCount > 0,
                  let chunk = try handle.read(upToCount: readCount),
                  !chunk.isEmpty else {
                break
            }
            data.append(chunk)
        }
        try Task.checkCancellation()
        return data
    }
}

@MainActor
private final class MediaPreviewModel: ObservableObject {
    @Published private(set) var image: NSImage?
    @Published private(set) var text: PreviewTextContent?
    @Published private(set) var document: PDFDocument?
    @Published private(set) var player: AVPlayer?
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private let loader = PreviewLoader()
    private var generation = UUID()

    func load(
        _ item: MediaItem,
        thumbnailStore: ThumbnailStore,
        displayScale: CGFloat
    ) async {
        let requestGeneration = UUID()
        generation = requestGeneration
        reset()
        isLoading = true

        do {
            switch item.bucket {
            case .image:
                let loaded = await thumbnailStore.thumbnail(
                    for: item,
                    size: CGSize(width: 900, height: 675),
                    scale: displayScale
                )
                guard generation == requestGeneration, !Task.isCancelled else { return }
                image = loaded

            case .video, .audio:
                player = AVPlayer(url: item.url)

            case .text:
                let loaded = try await loader.loadText(
                    url: item.url,
                    byteLimit: 256 * 1_024
                )
                guard generation == requestGeneration, !Task.isCancelled else { return }
                text = loaded

            case .document:
                let loaded = try await loader.loadPDF(url: item.url)
                guard generation == requestGeneration, !Task.isCancelled else { return }
                document = loaded.value

            case .other:
                break
            }
        } catch is CancellationError {
            return
        } catch {
            guard generation == requestGeneration else { return }
            errorMessage = error.localizedDescription
        }

        guard generation == requestGeneration else { return }
        isLoading = false
    }

    func stop() {
        generation = UUID()
        reset()
    }

    private func reset() {
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        player = nil
        image = nil
        text = nil
        document = nil
        errorMessage = nil
        isLoading = false
    }
}

struct MediaPreview: View {
    let item: MediaItem
    @ObservedObject var thumbnailStore: ThumbnailStore

    @Environment(\.displayScale) private var displayScale
    @StateObject private var model = MediaPreviewModel()

    var body: some View {
        ZStack {
            Color(nsColor: .controlBackgroundColor)

            if model.isLoading {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityLabel("Loading preview")
            } else if let image = model.image {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFit()
                    .accessibilityLabel("Preview of \(item.filename)")
            } else if let player = model.player {
                VideoPlayer(player: player)
                    .accessibilityLabel("Media player for \(item.filename)")
            } else if let text = model.text {
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(text.text)
                            .font(.system(.caption, design: .monospaced))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if text.isTruncated {
                            Text("Preview truncated")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(10)
                }
                .accessibilityLabel("Text preview of \(item.filename)")
            } else if let document = model.document {
                PDFPreview(document: document)
                    .accessibilityLabel("PDF preview of \(item.filename)")
            } else if let errorMessage = model.errorMessage {
                ContentUnavailableView(
                    "Preview Unavailable",
                    systemImage: "exclamationmark.triangle",
                    description: Text(errorMessage)
                )
            } else {
                Image(systemName: symbol(for: item.bucket))
                    .font(.system(size: 36))
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("No preview for \(item.filename)")
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .task(id: PreviewIdentity(item: item)) {
            await model.load(
                item,
                thumbnailStore: thumbnailStore,
                displayScale: displayScale
            )
        }
        .onDisappear {
            model.stop()
        }
    }

    private func symbol(for bucket: MediaBucket) -> String {
        switch bucket {
        case .image: "photo"
        case .video: "play.rectangle"
        case .audio: "waveform"
        case .text: "doc.text"
        case .document: "doc.richtext"
        case .other: "doc"
        }
    }
}

private struct PDFPreview: NSViewRepresentable {
    let document: PDFDocument

    func makeNSView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displaysPageBreaks = true
        return view
    }

    func updateNSView(_ view: PDFView, context: Context) {
        if view.document !== document {
            view.document = document
        }
    }
}
