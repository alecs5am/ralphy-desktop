import Foundation

public enum MediaScannerError: Error, Equatable {
    case notRalphyRoot
}

public struct MediaScanner: Sendable {
    private let imageExtensions = Set(["png", "jpg", "jpeg", "gif", "webp", "heic", "tiff", "bmp", "avif", "svg"])
    private let videoExtensions = Set(["mp4", "mov", "m4v", "webm"])
    private let audioExtensions = Set(["mp3", "wav", "m4a", "aac", "aiff", "flac", "ogg"])
    private let textExtensions = Set(["txt", "md", "markdown", "json", "jsonl", "srt", "html", "htm", "css", "js", "ts", "mjs", "cjs", "yaml", "yml", "toml", "xml", "csv", "tsv", "log", "py", "sh", "zsh"])
    private let documentExtensions = Set(["pdf"])
    private let prunedDirectoryNames = Set(["node_modules", ".build", ".git", "__pycache__", ".venv", "venv"])

    public init() {}

    public func scan(root: URL, options: ScanOptions = ScanOptions()) throws -> ScanResult {
        let root = root.standardizedFileURL
        guard root.lastPathComponent == ".ralphy",
              FileManager.default.fileExists(atPath: root.appending(path: "workspaces").path) else {
            throw MediaScannerError.notRalphyRoot
        }

        let keys: Set<URLResourceKey> = [.isDirectoryKey, .isRegularFileKey, .fileSizeKey, .creationDateKey, .contentModificationDateKey]
        guard let enumerator = FileManager.default.enumerator(
            at: root.appending(path: "workspaces"),
            includingPropertiesForKeys: Array(keys),
            options: [.skipsHiddenFiles, .skipsPackageDescendants]
        ) else {
            return ScanResult(items: [], skipped: 0)
        }

        var items: [MediaItem] = []
        var skipped = 0
        for case let fileURL as URL in enumerator {
            let values: URLResourceValues
            do {
                values = try fileURL.resourceValues(forKeys: keys)
            } catch {
                skipped += 1
                continue
            }

            if values.isDirectory == true {
                if shouldPrune(fileURL, includeIntermediates: options.includeIntermediates) {
                    enumerator.skipDescendants()
                }
                continue
            }

            guard values.isRegularFile == true else { continue }

            let ext = fileURL.pathExtension.lowercased()
            guard let bucket = bucket(for: ext) else { continue }
            let relativePath = fileURL.relativePath(from: root)
            let parts = relativePath.split(separator: "/").map(String.init)
            guard parts.count >= 5,
                  parts[0] == "workspaces",
                  parts[2] == "projects" else {
                skipped += 1
                continue
            }

            items.append(MediaItem(
                id: relativePath,
                url: fileURL,
                relativePath: relativePath,
                workspace: parts[1],
                project: parts[3],
                bucket: bucket,
                filename: fileURL.lastPathComponent,
                fileExtension: ext,
                sizeBytes: Int64(values.fileSize ?? 0),
                createdAt: values.creationDate,
                modifiedAt: values.contentModificationDate
            ))
        }

        items.sort { $0.relativePath < $1.relativePath }
        return ScanResult(items: items, skipped: skipped)
    }

    private func bucket(for fileExtension: String) -> MediaBucket? {
        if imageExtensions.contains(fileExtension) { return .image }
        if videoExtensions.contains(fileExtension) { return .video }
        if audioExtensions.contains(fileExtension) { return .audio }
        if textExtensions.contains(fileExtension) { return .text }
        if documentExtensions.contains(fileExtension) { return .document }
        return nil
    }

    private func shouldPrune(_ url: URL, includeIntermediates: Bool) -> Bool {
        if prunedDirectoryNames.contains(url.lastPathComponent) { return true }
        return !includeIntermediates &&
            url.deletingLastPathComponent().lastPathComponent == "render" &&
            url.lastPathComponent.hasPrefix("work-")
    }
}

private extension URL {
    func relativePath(from root: URL) -> String {
        let rootPath = root.standardizedFileURL.path
        let path = standardizedFileURL.path
        guard path.hasPrefix(rootPath + "/") else { return lastPathComponent }
        return String(path.dropFirst(rootPath.count + 1))
    }
}
