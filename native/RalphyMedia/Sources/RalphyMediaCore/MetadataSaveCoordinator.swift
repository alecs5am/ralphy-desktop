import Foundation

public actor MetadataSaveCoordinator {
    typealias Save = @Sendable (MetadataStore) async throws -> MetadataStore

    private let save: Save
    private var tails: [URL: Task<MetadataStore, Error>] = [:]

    public init() {
        self.save = { store in
            var saved = store
            try saved.save()
            return saved
        }
    }

    init(save: @escaping Save) {
        self.save = save
    }

    public func submit(_ store: MetadataStore) -> Task<MetadataStore, Error> {
        let previous = tails[store.root]
        let save = self.save
        let task = Task.detached(priority: .utility) {
            var next = store
            if let previous,
               let saved = try? await previous.value,
               saved.sessionID == store.sessionID {
                next = saved
                next.annotations = store.annotations
            }
            return try await save(next)
        }
        tails[store.root] = task
        return task
    }
}
