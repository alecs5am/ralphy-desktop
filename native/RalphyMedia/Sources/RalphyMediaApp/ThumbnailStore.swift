import AppKit
@preconcurrency import QuickLookThumbnailing
import RalphyMediaCore

@MainActor
final class ThumbnailStore: ObservableObject {
    private final class Cancellation: @unchecked Sendable {
        let generator: QLThumbnailGenerator
        let request: QLThumbnailGenerator.Request

        init(
            generator: QLThumbnailGenerator,
            request: QLThumbnailGenerator.Request
        ) {
            self.generator = generator
            self.request = request
        }

        func cancel() {
            generator.cancel(request)
        }
    }

    private let cache = NSCache<NSString, NSImage>()
    private let generator = QLThumbnailGenerator.shared

    init() {
        cache.countLimit = 512
        cache.totalCostLimit = 256 * 1_024 * 1_024
    }

    func thumbnail(
        for item: MediaItem,
        size: CGSize,
        scale: CGFloat
    ) async -> NSImage? {
        let pixelSize = CGSize(
            width: max(1, size.width * scale),
            height: max(1, size.height * scale)
        )
        let key = cacheKey(for: item, pixelSize: pixelSize)
        if let cached = cache.object(forKey: key) {
            return cached
        }

        let request = QLThumbnailGenerator.Request(
            fileAt: item.url,
            size: size,
            scale: scale,
            representationTypes: .thumbnail
        )
        let cancellation = Cancellation(generator: generator, request: request)

        do {
            let representation = try await withTaskCancellationHandler {
                try await generator.generateBestRepresentation(for: request)
            } onCancel: {
                cancellation.cancel()
            }
            try Task.checkCancellation()

            let image = representation.nsImage
            let cost = Int(pixelSize.width * pixelSize.height * 4)
            cache.setObject(image, forKey: key, cost: cost)
            return image
        } catch {
            return nil
        }
    }

    private func cacheKey(for item: MediaItem, pixelSize: CGSize) -> NSString {
        let modified = item.modifiedAt?.timeIntervalSince1970 ?? 0
        return "\(item.url.standardizedFileURL.path)|\(modified)|\(Int(pixelSize.width))x\(Int(pixelSize.height))" as NSString
    }
}
