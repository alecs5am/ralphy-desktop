import Foundation

public enum MediaScannerError: Error, Equatable {
    case notRalphyRoot
    case invalidProjectPath
    case projectNotFound
}

public struct MediaScanner: Sendable {
    private let imageExtensions = Set(["png", "jpg", "jpeg", "gif", "webp", "heic", "tiff", "bmp", "avif", "svg"])
    private let videoExtensions = Set(["mp4", "mov", "m4v", "webm"])
    private let audioExtensions = Set(["mp3", "wav", "m4a", "aac", "aiff", "flac", "ogg"])
    private let textExtensions = Set(["txt", "md", "markdown", "json", "jsonl", "srt", "html", "htm", "css", "js", "ts", "mjs", "cjs", "yaml", "yml", "toml", "xml", "csv", "tsv", "log", "py", "sh", "zsh"])
    private let documentExtensions = Set(["pdf"])
    private let prunedDirectoryNames = Set(["node_modules", ".build", ".git", "__pycache__", ".venv", "venv"])
    private let lifecycleDocumentNames = Set([
        "BRIEF.md", "STYLE.md", "PLAN.md", "PRODUCTION_PLAN.md", "SCENARIO.md",
        "PROMPTS.md", "EVALUATION.md", "REPAIR.md", "POSTMORTEM.md",
    ])

    public init() {}

    public func scan(root: URL, options: ScanOptions = ScanOptions()) throws -> ScanResult {
        let root = try validatedRoot(root)
        return scan(
            in: root.appending(path: "workspaces"),
            root: root,
            options: options,
            project: nil,
            attributions: [:]
        )
    }

    public func scan(
        project: ProjectReference,
        root: URL,
        options: ScanOptions = ScanOptions(),
        attributions: [String: GenerationAttribution] = [:]
    ) throws -> ScanResult {
        let root = try validatedRoot(root)
        let projectURL = try projectURL(for: project, root: root)
        return scan(
            in: projectURL,
            root: root,
            options: options,
            project: project,
            attributions: normalizedAttributions(attributions)
        )
    }

    private func validatedRoot(_ root: URL) throws -> URL {
        let root = root.standardizedFileURL
        guard root.lastPathComponent == ".ralphy",
              FileManager.default.fileExists(atPath: root.appending(path: "workspaces").path) else {
            throw MediaScannerError.notRalphyRoot
        }
        return root
    }

    private func projectURL(for project: ProjectReference, root: URL) throws -> URL {
        guard isSafePathComponent(project.workspaceID), isSafePathComponent(project.projectID) else {
            throw MediaScannerError.invalidProjectPath
        }

        let projectURL = root.appending(path: project.relativePath).standardizedFileURL
        let expectedParent = root
            .appending(path: "workspaces")
            .appending(path: project.workspaceID)
            .appending(path: "projects")
            .standardizedFileURL
        guard projectURL.deletingLastPathComponent() == expectedParent,
              projectURL.resolvingSymlinksInPath().isDescendant(of: root.resolvingSymlinksInPath()),
              let values = try? projectURL.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey]),
              values.isDirectory == true,
              values.isSymbolicLink != true else {
            throw MediaScannerError.projectNotFound
        }
        return projectURL
    }

    private func scan(
        in scanRoot: URL,
        root: URL,
        options: ScanOptions,
        project: ProjectReference?,
        attributions: [String: GenerationAttribution]
    ) -> ScanResult {
        let resolvedScanRoot = scanRoot.resolvingSymlinksInPath()

        let keys: Set<URLResourceKey> = [.isDirectoryKey, .isRegularFileKey, .fileSizeKey, .creationDateKey, .contentModificationDateKey]
        guard let enumerator = FileManager.default.enumerator(
            at: scanRoot,
            includingPropertiesForKeys: Array(keys),
            options: [.skipsHiddenFiles, .skipsPackageDescendants]
        ) else {
            return ScanResult(items: [], skipped: 0)
        }

        var items: [MediaItem] = []
        var skipped = 0
        for case let fileURL as URL in enumerator {
            guard fileURL.resolvingSymlinksInPath().isDescendant(of: resolvedScanRoot) else {
                enumerator.skipDescendants()
                skipped += 1
                continue
            }
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
            let workspace: String
            let projectID: String
            let projectRelativePath: String
            if let project {
                workspace = project.workspaceID
                projectID = project.projectID
                projectRelativePath = fileURL.relativePath(from: scanRoot)
            } else {
                let parts = relativePath.split(separator: "/").map(String.init)
                guard parts.count >= 5,
                      parts[0] == "workspaces",
                      parts[2] == "projects" else {
                    skipped += 1
                    continue
                }
                workspace = parts[1]
                projectID = parts[3]
                projectRelativePath = parts.dropFirst(4).joined(separator: "/")
            }

            items.append(MediaItem(
                id: relativePath,
                url: fileURL,
                relativePath: relativePath,
                workspace: workspace,
                project: projectID,
                bucket: bucket,
                filename: fileURL.lastPathComponent,
                fileExtension: ext,
                sizeBytes: Int64(values.fileSize ?? 0),
                createdAt: values.creationDate,
                modifiedAt: values.contentModificationDate,
                entity: entity(for: projectRelativePath),
                generation: normalizedProjectRelativePath(projectRelativePath).flatMap { attributions[$0] }
            ))
        }

        items.sort { $0.relativePath < $1.relativePath }
        return ScanResult(items: items, skipped: skipped)
    }

    private func isSafePathComponent(_ value: String) -> Bool {
        !value.isEmpty &&
            value != "." &&
            value != ".." &&
            !value.contains("/") &&
            !value.contains("\\")
    }

    private func entity(for projectRelativePath: String) -> RalphyEntityKind {
        let components = projectRelativePath.split(separator: "/").map(String.init)
        switch components {
        case let parts where parts.first == "render":
            return .finalRender
        case let parts where parts.starts(with: ["artifacts", "refs"]):
            return .reference
        case let parts where parts.first == "artifacts":
            return .generatedAsset
        case let parts where parts.first == "units":
            return .unit
        case let parts where lifecycleDocumentNames.contains(parts.last ?? ""):
            return .lifecycleDocument
        default:
            return .productionFile
        }
    }

    private func normalizedAttributions(
        _ attributions: [String: GenerationAttribution]
    ) -> [String: GenerationAttribution] {
        attributions.reduce(into: [:]) { result, entry in
            guard let path = normalizedProjectRelativePath(entry.key) else { return }
            result[path] = entry.value
        }
    }

    private func normalizedProjectRelativePath(_ path: String) -> String? {
        guard !path.hasPrefix("/") else { return nil }
        var components: [Substring] = []
        for component in path.split(separator: "/", omittingEmptySubsequences: true) {
            switch component {
            case ".": continue
            case "..": return nil
            default: components.append(component)
            }
        }
        guard !components.isEmpty else { return nil }
        return components.joined(separator: "/")
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

    func isDescendant(of directory: URL) -> Bool {
        let directoryPath = directory.standardizedFileURL.path
        let path = standardizedFileURL.path
        return path.hasPrefix(directoryPath + "/")
    }
}
