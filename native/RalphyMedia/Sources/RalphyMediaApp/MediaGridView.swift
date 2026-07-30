import AppKit
import RalphyMediaCore
import SwiftUI

enum GridNavigationDirection: Sendable {
    case left
    case right
    case up
    case down
}

enum GridNavigation {
    static func targetIndex(
        current: Int?,
        itemCount: Int,
        columnCount: Int,
        direction: GridNavigationDirection
    ) -> Int? {
        guard itemCount > 0 else { return nil }
        guard let current else {
            return switch direction {
            case .left, .up: itemCount - 1
            case .right, .down: 0
            }
        }
        let boundedCurrent = min(itemCount - 1, max(0, current))
        let columns = max(1, columnCount)
        let offset = switch direction {
        case .left: -1
        case .right: 1
        case .up: -columns
        case .down: columns
        }
        return min(itemCount - 1, max(0, boundedCurrent + offset))
    }
}

struct MediaGridView: View {
    @ObservedObject var viewModel: LibraryViewModel
    @ObservedObject var thumbnailStore: ThumbnailStore

    @FocusState private var gridIsFocused: Bool
    @State private var adaptiveColumnCount = 1

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVGrid(
                    columns: [
                        GridItem(
                            .adaptive(
                                minimum: viewModel.gridSize,
                                maximum: viewModel.gridSize * 1.35
                            ),
                            spacing: 12
                        ),
                    ],
                    alignment: .leading,
                    spacing: 16,
                    pinnedViews: [.sectionHeaders]
                ) {
                    ForEach(viewModel.visibleSections) { section in
                        Section {
                            ForEach(section.items) { item in
                                MediaTile(
                                    item: item,
                                    annotation: viewModel.annotation(for: item),
                                    selected: viewModel.selectedIDs.contains(item.id),
                                    requestedWidth: viewModel.gridSize,
                                    thumbnailStore: thumbnailStore
                                )
                                .id(item.id)
                                .onTapGesture(count: 2) {
                                    viewModel.select(item)
                                    viewModel.showQuickLook()
                                }
                                .onTapGesture {
                                    let modifiers = NSEvent.modifierFlags
                                    viewModel.select(
                                        item,
                                        command: modifiers.contains(.command),
                                        shift: modifiers.contains(.shift)
                                    )
                                    gridIsFocused = true
                                }
                                .onDrag {
                                    if !viewModel.selectedIDs.contains(item.id) {
                                        viewModel.select(item)
                                    }
                                    return NSItemProvider(object: item.url as NSURL)
                                } preview: {
                                    Label(item.filename, systemImage: symbol(for: item.bucket))
                                        .padding(8)
                                }
                                .contextMenu {
                                    itemMenu(for: item)
                                }
                            }
                        } header: {
                            if viewModel.query.group != .none {
                                HStack {
                                    Text(section.title)
                                        .font(.headline)
                                        .lineLimit(1)
                                    Text(section.items.count, format: .number)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    Spacer()
                                }
                                .padding(.vertical, 5)
                                .background(.bar)
                                .accessibilityElement(children: .combine)
                            }
                        }
                    }
                }
                .padding(14)
            }
            .background {
                GeometryReader { geometry in
                    Color.clear
                        .onAppear {
                            updateColumnCount(for: geometry.size.width)
                        }
                        .onChange(of: geometry.size.width) {
                            updateColumnCount(for: geometry.size.width)
                        }
                        .onChange(of: viewModel.gridSize) {
                            updateColumnCount(for: geometry.size.width)
                        }
                }
            }
            .background(Color(nsColor: .underPageBackgroundColor))
            .focusable()
            .focused($gridIsFocused)
            .onMoveCommand { direction in
                moveSelection(direction, proxy: proxy)
            }
            .onKeyPress(.space) {
                viewModel.showQuickLook()
                return .handled
            }
            .onDeleteCommand {
                viewModel.requestTrash()
            }
            .onExitCommand {
                viewModel.clearSelection()
            }
            .overlay {
                if viewModel.isScanning && viewModel.rootURL == nil {
                    ProgressView("Scanning Library")
                        .controlSize(.small)
                } else if viewModel.rootURL == nil {
                    ContentUnavailableView {
                        Label("No Library Selected", systemImage: "folder")
                    } description: {
                        Text("Choose a .ralphy folder to begin.")
                    } actions: {
                        Button("Choose Library") {
                            viewModel.pickLibrary()
                        }
                    }
                } else if viewModel.visibleItems.isEmpty {
                    ContentUnavailableView(
                        "No Matching Files",
                        systemImage: "line.3.horizontal.decrease.circle"
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func itemMenu(for item: MediaItem) -> some View {
        Button("Quick Look", systemImage: "eye") {
            viewModel.select(item)
            viewModel.showQuickLook()
        }
        Button("Open", systemImage: "arrow.up.forward.app") {
            selectForBatchAction(item)
            viewModel.openSelection()
        }
        Button("Reveal in Finder", systemImage: "folder") {
            selectForBatchAction(item)
            viewModel.revealSelectionInFinder()
        }

        Divider()

        Menu("Verdict") {
            ForEach(ReviewVerdict.allCases, id: \.self) { verdict in
                Button(verdict.displayName) {
                    selectForBatchAction(item)
                    viewModel.setVerdict(verdict)
                }
            }
        }
        Menu("Rating") {
            ForEach(0...5, id: \.self) { rating in
                Button(rating == 0 ? "Clear Rating" : "\(rating) Stars") {
                    selectForBatchAction(item)
                    viewModel.setRating(rating)
                }
            }
        }
        Button("Toggle Favorite", systemImage: "star") {
            selectForBatchAction(item)
            viewModel.toggleFavorite()
        }

        Divider()

        Button("Copy Paths", systemImage: "doc.on.doc") {
            selectForBatchAction(item)
            viewModel.copyPaths()
        }
        Button("Copy for Agent", systemImage: "text.badge.plus") {
            selectForBatchAction(item)
            viewModel.copyForAgent()
        }
        Button("Move to Trash", systemImage: "trash", role: .destructive) {
            selectForBatchAction(item)
            viewModel.requestTrash()
        }
        .disabled(viewModel.isApplyingQuery || viewModel.isTrashing)
    }

    private func selectForBatchAction(_ item: MediaItem) {
        if !viewModel.selectedIDs.contains(item.id) {
            viewModel.select(item)
        }
    }

    private func updateColumnCount(for width: CGFloat) {
        let availableWidth = max(0, width - 28)
        adaptiveColumnCount = max(
            1,
            Int((availableWidth + 12) / (viewModel.gridSize + 12))
        )
    }

    private func moveSelection(
        _ direction: MoveCommandDirection,
        proxy: ScrollViewProxy
    ) {
        let gridDirection: GridNavigationDirection
        switch direction {
        case .left:
            gridDirection = .left
        case .right:
            gridDirection = .right
        case .up:
            gridDirection = .up
        case .down:
            gridDirection = .down
        @unknown default:
            return
        }

        guard let target = GridNavigation.targetIndex(
            current: viewModel.primarySelectionIndex,
            itemCount: viewModel.visibleItems.count,
            columnCount: adaptiveColumnCount,
            direction: gridDirection
        ) else {
            return
        }
        viewModel.selectVisibleItem(
            at: target,
            extending: NSEvent.modifierFlags.contains(.shift)
        )
        if let id = viewModel.primarySelection?.id {
            proxy.scrollTo(id, anchor: .center)
        }
    }
}

struct LibraryStatusStrip: View {
    @ObservedObject var viewModel: LibraryViewModel

    var body: some View {
        HStack(spacing: 14) {
            Text("\(viewModel.visibleItems.count) visible")
            Text("\(viewModel.items.count) total")
            Text("\(viewModel.selectedIDs.count) selected")
            Spacer(minLength: 12)
            if let progress = viewModel.trashProgress {
                ProgressView(
                    value: Double(progress.completed),
                    total: Double(progress.total)
                )
                .frame(width: 72)
                .accessibilityLabel("Moving files to Trash")
                Text("Trash \(progress.completed)/\(progress.total)")
            } else if viewModel.isScanning {
                ProgressView()
                    .controlSize(.mini)
                    .accessibilityLabel("Scanning")
            }
            Text(viewModel.statusText)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .monospacedDigit()
        .padding(.horizontal, 10)
        .frame(height: 26)
        .background(.bar)
        .overlay(alignment: .top) {
            Divider()
        }
        .accessibilityElement(children: .combine)
    }
}

private struct MediaTile: View {
    let item: MediaItem
    let annotation: MediaAnnotation
    let selected: Bool
    let requestedWidth: CGFloat
    @ObservedObject var thumbnailStore: ThumbnailStore

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            ZStack(alignment: .topLeading) {
                ThumbnailView(
                    item: item,
                    requestedSize: CGSize(
                        width: requestedWidth,
                        height: requestedWidth * 0.75
                    ),
                    thumbnailStore: thumbnailStore
                )

                if !item.fileExtension.isEmpty {
                    Text(item.fileExtension.uppercased())
                        .font(.caption2.weight(.semibold))
                        .lineLimit(1)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .foregroundStyle(.white)
                        .background(.black.opacity(0.58))
                        .clipShape(RoundedRectangle(cornerRadius: 3))
                        .padding(5)
                        .accessibilityHidden(true)
                }

                HStack(spacing: 5) {
                    if annotation.favorite {
                        Image(systemName: "star.fill")
                            .foregroundStyle(.yellow)
                    }
                    Image(systemName: verdictSymbol(annotation.verdict))
                        .foregroundStyle(verdictColor(annotation.verdict))
                }
                .font(.caption)
                .padding(6)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .accessibilityHidden(true)
            }
            .aspectRatio(4 / 3, contentMode: .fit)

            Text(item.filename)
                .font(.caption)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: 5) {
                Text(item.project)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 4)
                if annotation.rating > 0 {
                    Image(systemName: "star.fill")
                    Text(annotation.rating, format: .number)
                        .monospacedDigit()
                }
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
            .frame(height: 14)
        }
        .padding(5)
        .background(selected ? Color.accentColor.opacity(0.14) : .clear)
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .stroke(
                    selected ? Color.accentColor : Color(nsColor: .separatorColor),
                    lineWidth: selected ? 2 : 1
                )
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .contentShape(Rectangle())
        .help(item.relativePath)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }

    private var accessibilityLabel: String {
        var parts = [
            item.filename,
            item.project,
            annotation.verdict.displayName,
            "rating \(annotation.rating) of 5",
        ]
        if annotation.favorite {
            parts.append("favorite")
        }
        return parts.joined(separator: ", ")
    }
}

private struct ThumbnailView: View {
    let item: MediaItem
    let requestedSize: CGSize
    @ObservedObject var thumbnailStore: ThumbnailStore

    @Environment(\.displayScale) private var displayScale
    @State private var image: NSImage?
    @State private var loadTask: Task<Void, Never>?

    var body: some View {
        Rectangle()
            .fill(Color(nsColor: .controlBackgroundColor))
            .overlay {
                if let image {
                    Image(nsImage: image)
                        .resizable()
                        .scaledToFill()
                } else {
                    Image(systemName: symbol(for: item.bucket))
                        .font(.system(size: 30))
                        .foregroundStyle(.secondary)
                }
            }
            .clipped()
            .onAppear(perform: load)
            .onChange(of: requestID) {
                load()
            }
            .onDisappear {
                loadTask?.cancel()
                loadTask = nil
            }
            .accessibilityHidden(true)
    }

    private var requestID: String {
        "\(item.id)|\(item.modifiedAt?.timeIntervalSince1970 ?? 0)|\(item.sizeBytes)|\(requestedSize.width)|\(displayScale)"
    }

    private func load() {
        loadTask?.cancel()
        image = nil
        loadTask = Task {
            let loaded = await thumbnailStore.thumbnail(
                for: item,
                size: requestedSize,
                scale: displayScale
            )
            guard !Task.isCancelled else { return }
            image = loaded
        }
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

private func verdictSymbol(_ verdict: ReviewVerdict) -> String {
    switch verdict {
    case .unreviewed: "circle"
    case .keep: "checkmark.circle.fill"
    case .maybe: "questionmark.circle.fill"
    case .needsWork: "exclamationmark.circle.fill"
    case .reject: "xmark.circle.fill"
    }
}

private func verdictColor(_ verdict: ReviewVerdict) -> Color {
    switch verdict {
    case .unreviewed: .secondary
    case .keep: .green
    case .maybe: .orange
    case .needsWork: .orange
    case .reject: .red
    }
}
