import AppKit
import Foundation
import RalphyMediaCore

extension LibraryViewModel {
    func beginTermination() {
        isTerminating = true
        rootLoadGeneration &+= 1
        catalogGeneration &+= 1
        catalogTask?.cancel()
        invalidateProjectLoads()
    }

    func cancelTermination() {
        isTerminating = false
    }

    func annotation(for item: MediaItem) -> MediaAnnotation {
        annotations[item.relativePath] ?? MediaAnnotation()
    }

    func updateAnnotation(
        for item: MediaItem,
        _ edit: (inout MediaAnnotation) -> Void
    ) {
        mutateAnnotations(for: [item], edit)
    }

    func setVerdict(_ verdict: ReviewVerdict) {
        mutateAnnotations(for: selectedItems) { $0.verdict = verdict }
    }

    func setRating(_ rating: Int) {
        mutateAnnotations(for: selectedItems) { $0.rating = rating }
    }

    func setFavorite(_ favorite: Bool) {
        mutateAnnotations(for: selectedItems) { $0.favorite = favorite }
    }

    func toggleFavorite() {
        let selected = selectedItems
        let allFavorites = !selected.isEmpty &&
            selected.allSatisfy { annotation(for: $0).favorite }
        mutateAnnotations(for: selected) { $0.favorite = !allFavorites }
    }

    func addTags(_ tags: [String]) {
        mutateAnnotations(for: selectedItems) { $0.tags += tags }
    }

    func removeTags(_ tags: [String]) {
        let removed = Set(tags.map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        })
        mutateAnnotations(for: selectedItems) {
            $0.tags.removeAll { removed.contains($0.lowercased()) }
        }
    }

    func setNote(_ note: String) {
        mutateAnnotations(for: selectedItems) { $0.note = note }
    }

    func showQuickLook() {
        quickLookURL = primarySelection?.url
    }

    func clearQuickLook() {
        quickLookURL = nil
    }

    func copyPaths() {
        let text = selectedItems.map(\.url.path).joined(separator: "\n")
        guard !text.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    func copyForAgent() {
        let selected = selectedItems
        guard !selected.isEmpty else { return }
        let text = AgentFeedback.render(items: selected, annotations: annotations)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    func openSelection() {
        for item in selectedItems {
            NSWorkspace.shared.open(item.url)
        }
    }

    func revealSelectionInFinder() {
        let urls = selectedItems.map(\.url)
        guard !urls.isEmpty else { return }
        NSWorkspace.shared.activateFileViewerSelecting(urls)
    }

    func requestTrash() {
        guard !isTerminating, !isApplyingQuery, !isTrashing else { return }
        let selected = selectedItems
        guard !selected.isEmpty else { return }
        pendingTrashConfirmation = selected
    }

    func confirmTrash() {
        guard !isTerminating,
              !isTrashing,
              let pending = pendingTrashConfirmation,
              !pending.isEmpty else {
            return
        }
        rootLoadGeneration &+= 1
        catalogGeneration &+= 1
        catalogTask?.cancel()
        invalidateProjectLoads()
        pendingTrashConfirmation = nil
        trashProgress = TrashProgress(completed: 0, total: pending.count)
        let trashItem = self.trashItem

        trashTask = Task { [weak self] in
            let result = await Task.detached(priority: .userInitiated) {
                var trashedIDs = Set<String>()
                var failures: [TrashFailure] = []
                for (index, item) in pending.enumerated() {
                    do {
                        try trashItem(item.url)
                        trashedIDs.insert(item.id)
                    } catch {
                        failures.append(
                            TrashFailure(
                                filename: item.filename,
                                message: error.localizedDescription
                            )
                        )
                    }
                    await self?.updateTrashProgress(
                        completed: index + 1,
                        total: pending.count
                    )
                }
                return TrashBatchResult(
                    trashedIDs: trashedIDs,
                    failures: failures
                )
            }.value
            self?.finishTrash(result)
        }
    }

    func cancelTrash() {
        pendingTrashConfirmation = nil
    }

    func moveSelectionToTrash() {
        requestTrash()
    }

    @discardableResult
    func flushPendingAnnotationSaves() async -> Bool {
        while let request = pendingAnnotationSaves.values.min(
            by: { $0.generation < $1.generation }
        ) {
            guard case .saved = await flushPendingAnnotationSave(
                for: request.store.root
            ) else {
                return false
            }
        }
        return true
    }

    func completePendingTerminationWork() async -> Bool {
        while true {
            if let trashTask {
                await trashTask.value
                continue
            }
            if hasPendingAnnotationSaves {
                guard await flushPendingAnnotationSaves() else { return false }
                continue
            }
            return true
        }
    }

    func flushPendingAnnotationSave(
        for root: URL
    ) async -> AnnotationSaveOutcome {
        while let request = pendingAnnotationSaves[root] {
            metadataSaveTasks[root]?.cancel()
            let outcome = await persistAnnotationSave(request)
            guard case .saved = outcome else { return outcome }
        }
        return .saved
    }

    func cancelPendingSave(for root: URL) {
        metadataSaveTasks[root]?.cancel()
        metadataSaveTasks[root] = nil
        pendingAnnotationSaves[root] = nil
    }

    private func updateTrashProgress(completed: Int, total: Int) {
        guard isTrashing else { return }
        trashProgress = TrashProgress(completed: completed, total: total)
    }

    private func finishTrash(_ result: TrashBatchResult) {
        trashProgress = nil
        trashTask = nil

        if !result.trashedIDs.isEmpty {
            projectItemsState.removeAll { result.trashedIDs.contains($0.id) }
            selectionState.subtract(result.trashedIDs)
            updateSourceCounts()
            requestVisibleItemsUpdate()
            requestSelectedProjectRefresh()
        }
        if !result.failures.isEmpty {
            let failures = result.failures.map { "\($0.filename): \($0.message)" }
            errorMessage = "Could not move files to Trash:\n" +
                failures.joined(separator: "\n")
        }
    }

    private func mutateAnnotations(
        for targets: [MediaItem],
        _ edit: (inout MediaAnnotation) -> Void
    ) {
        guard !isTerminating, !targets.isEmpty else { return }
        let updatedAt = Date()
        var updatedAnnotations = annotations
        var verdictChanged = false
        var favoriteChanged = false
        var searchMetadataChanged = false

        for item in targets {
            var annotation = annotation(for: item)
            let previous = annotation
            edit(&annotation)
            annotation.updatedAt = updatedAt
            updatedAnnotations[item.relativePath] = annotation
            verdictChanged = verdictChanged || previous.verdict != annotation.verdict
            favoriteChanged = favoriteChanged || previous.favorite != annotation.favorite
            searchMetadataChanged = searchMetadataChanged ||
                previous.tags != annotation.tags ||
                previous.note != annotation.note
        }
        annotations = updatedAnnotations
        if desiredContext?.root == rootURL {
            desiredContext?.annotations = annotations
        }
        if verdictChanged || favoriteChanged {
            updateSourceCounts()
        }
        let searchActive = !(query.search?.isEmpty ?? true)
        if verdictChanged && (query.verdict != nil || query.excludeRejected) ||
            favoriteChanged && query.favoriteOnly ||
            searchMetadataChanged && searchActive {
            requestVisibleItemsUpdate()
        }
        saveAnnotations()
    }

    private func saveAnnotations() {
        guard let store else {
            if let warning = desiredContext?.metadataWarning {
                errorMessage = warning
            }
            return
        }

        annotationSaveGeneration &+= 1
        let root = store.root
        let request = AnnotationSaveRequest(
            generation: annotationSaveGeneration,
            store: store,
            annotations: annotations
        )
        pendingAnnotationSaves[root] = request
        metadataSaveTasks[root]?.cancel()
        metadataSaveTasks[root] = Task { [weak self] in
            do {
                try await Task.sleep(for: .milliseconds(350))
                try Task.checkCancellation()
            } catch {
                return
            }
            _ = await self?.persistAnnotationSave(request)
        }
    }

    private func persistAnnotationSave(
        _ request: AnnotationSaveRequest
    ) async -> AnnotationSaveOutcome {
        var updatedStore = request.store
        updatedStore.annotations = request.annotations

        do {
            let savedStore = try await annotationSave(updatedStore)
            let root = request.store.root
            guard pendingAnnotationSaves[root]?.generation == request.generation else {
                return .saved
            }
            pendingAnnotationSaves[root] = nil
            metadataSaveTasks[root] = nil
            metadataSaveCompleted(savedStore)
            return .saved
        } catch let error as MetadataStoreError {
            errorMessage = "Annotations were not saved. \(error.localizedDescription)"
            switch error {
            case .conflict, .corruptFile, .unsupportedFutureSchema:
                return .reloadRequired
            }
        } catch {
            errorMessage = "Annotations were not saved. \(error.localizedDescription)"
        }
        return .retryableFailure
    }

    private func metadataSaveCompleted(_ savedStore: MetadataStore) {
        guard rootURL == savedStore.root else { return }
        store = savedStore
        if desiredContext?.root == savedStore.root {
            desiredContext?.store = savedStore
        }
    }
}
