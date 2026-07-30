import CoreServices
import Foundation
import RalphyMediaCore

final class FolderWatcher {
    private let workspacesURL: URL
    private let onChange: MainActorCallback
    private var stream: FSEventStreamRef?
    private let queue = DispatchQueue(label: "app.ralphy.media.folder-watcher")

    init(
        root: URL,
        onChange: @escaping @MainActor @Sendable ([String]) -> Void
    ) {
        self.workspacesURL = root.appending(path: "workspaces")
        self.onChange = MainActorCallback(action: onChange)
    }

    deinit {
        stop()
    }

    func start() {
        stop()

        var context = FSEventStreamContext(
            version: 0,
            info: Unmanaged.passUnretained(self).toOpaque(),
            retain: nil,
            release: nil,
            copyDescription: nil
        )

        let callback: FSEventStreamCallback = { _, info, eventCount, eventPaths, _, _ in
            guard let info else { return }
            let watcher = Unmanaged<FolderWatcher>.fromOpaque(info).takeUnretainedValue()
            let paths = Unmanaged<CFArray>.fromOpaque(eventPaths)
                .takeUnretainedValue() as? [String] ?? []
            watcher.onChange.call(paths.prefix(Int(eventCount)).map {
                URL(filePath: $0).standardizedFileURL.path
            })
        }

        stream = FSEventStreamCreate(
            kCFAllocatorDefault,
            callback,
            &context,
            [workspacesURL.path] as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            0.5,
            UInt32(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagUseCFTypes)
        )

        if let stream {
            FSEventStreamSetDispatchQueue(stream, queue)
            FSEventStreamStart(stream)
        }
    }

    func stop() {
        guard let stream else { return }
        self.stream = nil
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
    }
}

private struct MainActorCallback: Sendable {
    let action: @MainActor @Sendable ([String]) -> Void

    func call(_ paths: [String]) {
        var seen = Set<String>()
        let paths = paths.filter { seen.insert($0).inserted }
        guard !paths.isEmpty else { return }
        Task { @MainActor in
            action(paths)
        }
    }
}

struct FolderChangeSet: Equatable, Sendable {
    let projects: [ProjectReference]
    let catalogStructureChanged: Bool
}

enum FolderChangeRouter {
    static func route(paths: [String], root: URL) -> FolderChangeSet {
        let rootComponents = root.standardizedFileURL.pathComponents
        var projects: [ProjectReference] = []
        var seenProjects = Set<ProjectReference>()
        var catalogStructureChanged = false

        for path in paths {
            let components = URL(filePath: path).standardizedFileURL.pathComponents
            guard components.starts(with: rootComponents) else { continue }
            let relative = Array(components.dropFirst(rootComponents.count))

            guard let first = relative.first else {
                catalogStructureChanged = true
                continue
            }
            if first == "media-library" {
                continue
            }
            guard first == "workspaces" else {
                catalogStructureChanged = true
                continue
            }
            guard relative.count >= 3, relative[2] == "projects" else {
                catalogStructureChanged = true
                continue
            }
            guard relative.count >= 5 else {
                catalogStructureChanged = true
                continue
            }

            let project = ProjectReference(workspaceID: relative[1], projectID: relative[3])
            if seenProjects.insert(project).inserted {
                projects.append(project)
            }
        }

        return FolderChangeSet(
            projects: projects,
            catalogStructureChanged: catalogStructureChanged
        )
    }
}
