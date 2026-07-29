import Foundation

public actor ReloadCoalescer {
    private let delay: Duration
    private let action: @Sendable () async -> Void
    private var debounceTask: Task<Void, Never>?
    private var activeTask: Task<Void, Never>?
    private var dirty = false

    public init(
        delay: Duration,
        action: @escaping @Sendable () async -> Void
    ) {
        self.delay = delay
        self.action = action
    }

    public func request() {
        guard debounceTask == nil, activeTask == nil else {
            dirty = true
            return
        }
        schedule()
    }

    private func schedule() {
        debounceTask = Task { [delay] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            begin()
        }
    }

    private func begin() {
        debounceTask = nil
        activeTask = Task { [action] in
            await action()
            finished()
        }
    }

    private func finished() {
        activeTask = nil
        guard dirty else { return }
        dirty = false
        schedule()
    }
}
