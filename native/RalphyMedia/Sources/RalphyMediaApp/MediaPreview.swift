import AppKit
import AVKit
import PDFKit
import RalphyMediaCore
import SwiftUI

struct PreviewTextContent: Sendable {
    let text: String
    let isTruncated: Bool
}

enum PreviewTextReader {
    static func read(url: URL, byteLimit: Int) async throws -> PreviewTextContent {
        try await Task.detached(priority: .userInitiated) {
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }

            let limit = max(0, byteLimit)
            let data = try handle.read(upToCount: limit + 1) ?? Data()
            return PreviewTextContent(
                text: String(decoding: data.prefix(limit), as: UTF8.self),
                isTruncated: data.count > limit
            )
        }.value
    }
}

private struct LoadedImage: @unchecked Sendable {
    let value: NSImage
}

private struct LoadedPDF: @unchecked Sendable {
    let value: PDFDocument
}

@MainActor
private final class MediaPreviewModel: ObservableObject {
    @Published private(set) var image: NSImage?
    @Published private(set) var text: PreviewTextContent?
    @Published private(set) var document: PDFDocument?
    @Published private(set) var player: AVPlayer?
    @Published private(set) var isLoading = false
    @Published private(set) var errorMessage: String?

    private var generation = UUID()

    func load(_ item: MediaItem) async {
        let requestGeneration = UUID()
        generation = requestGeneration
        reset()
        isLoading = true

        do {
            switch item.bucket {
            case .image:
                let loaded = try await Task.detached(priority: .userInitiated) {
                    let data = try Data(contentsOf: item.url, options: .mappedIfSafe)
                    guard let source = NSImage(data: data) else {
                        throw CocoaError(.fileReadCorruptFile)
                    }
                    var proposedRect = NSRect(origin: .zero, size: source.size)
                    guard let decoded = source.cgImage(
                        forProposedRect: &proposedRect,
                        context: nil,
                        hints: nil
                    ) else {
                        throw CocoaError(.fileReadCorruptFile)
                    }
                    return LoadedImage(value: NSImage(cgImage: decoded, size: source.size))
                }.value
                guard generation == requestGeneration, !Task.isCancelled else { return }
                image = loaded.value

            case .video, .audio:
                player = AVPlayer(url: item.url)

            case .text:
                let loaded = try await PreviewTextReader.read(
                    url: item.url,
                    byteLimit: 256 * 1_024
                )
                guard generation == requestGeneration, !Task.isCancelled else { return }
                text = loaded

            case .document:
                let loaded = try await Task.detached(priority: .userInitiated) {
                    guard let document = PDFDocument(url: item.url) else {
                        throw CocoaError(.fileReadCorruptFile)
                    }
                    return LoadedPDF(value: document)
                }.value
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
        .task(id: item.id) {
            await model.load(item)
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
