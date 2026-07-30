import CoreServices
import Foundation

final class FolderWatcher {
    private let workspacesURL: URL
    private let onChange: MainActorCallback
    private var stream: FSEventStreamRef?
    private let queue = DispatchQueue(label: "app.ralphy.media.folder-watcher")

    init(
        root: URL,
        onChange: @escaping @MainActor @Sendable () -> Void
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

        let callback: FSEventStreamCallback = { _, info, _, _, _, _ in
            guard let info else { return }
            let watcher = Unmanaged<FolderWatcher>.fromOpaque(info).takeUnretainedValue()
            watcher.onChange.call()
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
    let action: @MainActor @Sendable () -> Void

    func call() {
        Task { @MainActor in
            action()
        }
    }
}
