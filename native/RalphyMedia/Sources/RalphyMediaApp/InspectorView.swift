import RalphyMediaCore
import SwiftUI

struct InspectorView: View {
    @ObservedObject var viewModel: LibraryViewModel
    @State private var tagText = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: RalphyTheme.Spacing.large) {
                if let item = viewModel.primarySelection {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: RalphyTheme.Spacing.small) {
                            Label(
                                ProjectPresentation.entityLabel(item.entity),
                                systemImage: ProjectPresentation.entitySymbol(item.entity)
                            )
                            .foregroundStyle(RalphyTheme.focus)
                            Spacer()
                            Text(viewModel.annotation(for: item).verdict.displayName)
                                .foregroundStyle(
                                    inspectorVerdictColor(
                                        viewModel.annotation(for: item).verdict
                                    )
                                )
                        }
                        .font(.system(size: 10, weight: .medium))

                        Text(item.filename)
                            .font(.system(size: 14, weight: .semibold))
                            .lineLimit(2)
                            .textSelection(.enabled)
                        if viewModel.selectedItems.count > 1 {
                            Text("\(viewModel.selectedItems.count) items selected")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            Text(item.relativePath)
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(RalphyTheme.secondaryText)
                                .lineLimit(2)
                                .truncationMode(.middle)
                                .textSelection(.enabled)
                        }
                    }

                    Divider()
                    reviewControls
                    Divider()
                    tagAndNoteControls
                    Divider()
                    SelectionProperties(items: viewModel.selectedItems)
                    Divider()
                    actionControls
                } else {
                    ContentUnavailableView(
                        "No Selection",
                        systemImage: "sidebar.right"
                    )
                    .frame(maxWidth: .infinity, minHeight: 320)
                }
            }
            .padding(RalphyTheme.Spacing.large)
        }
        .background(RalphyTheme.sidebar)
        .foregroundStyle(RalphyTheme.primaryText)
        .inspectorColumnWidth(min: 300, ideal: 340, max: 420)
        .onChange(of: viewModel.selectedIDs) {
            tagText = ""
        }
    }

    private var reviewControls: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Review")
                .font(.subheadline.weight(.semibold))

            Picker("Verdict", selection: Binding(
                get: { common(\.verdict) },
                set: { verdict in
                    if let verdict {
                        viewModel.setVerdict(verdict)
                    }
                }
            )) {
                ForEach(ReviewVerdict.allCases, id: \.self) { verdict in
                    Text(verdict.displayName)
                        .tag(Optional(verdict))
                }
            }
            .pickerStyle(.menu)
            .accessibilityLabel("Verdict for selected files")

            HStack(spacing: 7) {
                Button {
                    viewModel.setRating(0)
                } label: {
                    Image(systemName: "star.slash")
                }
                .buttonStyle(.plain)
                .help("Clear Rating")
                .accessibilityLabel("Clear rating")

                ForEach(1...5, id: \.self) { rating in
                    Button {
                        viewModel.setRating(rating)
                    } label: {
                        Image(
                            systemName: (common(\.rating) ?? 0) >= rating
                                ? "star.fill"
                                : "star"
                        )
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(RalphyTheme.amber)
                    .help("Set Rating to \(rating)")
                    .accessibilityLabel("Set rating to \(rating) of 5")
                }

                Spacer()

                Toggle("Favorite", isOn: Binding(
                    get: { common(\.favorite) ?? false },
                    set: { viewModel.setFavorite($0) }
                ))
                .toggleStyle(.checkbox)
                .help(common(\.favorite) == nil ? "Mixed favorite state" : "Favorite")
            }
        }
    }

    private var tagAndNoteControls: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("Tags and Note")
                .font(.subheadline.weight(.semibold))

            if let tags = common(\.tags), !tags.isEmpty {
                Text(tags.joined(separator: ", "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .textSelection(.enabled)
            } else if common(\.tags) == nil {
                Text("Mixed tags")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 6) {
                TextField("Tags", text: $tagText)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(addTags)
                    .accessibilityLabel("Tags to add or remove")
                Button(action: addTags) {
                    Image(systemName: "plus")
                }
                .help("Add Tags")
                .accessibilityLabel("Add tags")
                .disabled(parsedTags.isEmpty)
                Button(action: removeTags) {
                    Image(systemName: "minus")
                }
                .help("Remove Tags")
                .accessibilityLabel("Remove tags")
                .disabled(parsedTags.isEmpty)
            }

            TextField(
                common(\.note) == nil ? "Set note for selection" : "Note",
                text: Binding(
                    get: { common(\.note) ?? "" },
                    set: { viewModel.setNote($0) }
                ),
                axis: .vertical
            )
            .lineLimit(3...7)
            .accessibilityLabel("Note for selected files")
        }
    }

    private var actionControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Actions")
                .font(.subheadline.weight(.semibold))

            Grid(horizontalSpacing: 8, verticalSpacing: 8) {
                GridRow {
                    Button("Open", systemImage: "arrow.up.forward.app") {
                        viewModel.openSelection()
                    }
                    Button("Reveal", systemImage: "folder") {
                        viewModel.revealSelectionInFinder()
                    }
                }
                GridRow {
                    Button("Copy Paths", systemImage: "doc.on.doc") {
                        viewModel.copyPaths()
                    }
                    Button("Copy for Agent", systemImage: "text.badge.plus") {
                        viewModel.copyForAgent()
                    }
                }
            }
            .buttonStyle(.bordered)

            Button("Move to Trash", systemImage: "trash", role: .destructive) {
                viewModel.requestTrash()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .disabled(viewModel.isApplyingQuery || viewModel.isTrashing)
        }
    }

    private var parsedTags: [String] {
        tagText
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private func common<Value: Equatable>(
        _ keyPath: KeyPath<MediaAnnotation, Value>
    ) -> Value? {
        let annotations = viewModel.selectedItems.map(viewModel.annotation(for:))
        guard let first = annotations.first?[keyPath: keyPath],
              annotations.dropFirst().allSatisfy({ $0[keyPath: keyPath] == first }) else {
            return nil
        }
        return first
    }

    private func addTags() {
        guard !parsedTags.isEmpty else { return }
        viewModel.addTags(parsedTags)
        tagText = ""
    }

    private func removeTags() {
        guard !parsedTags.isEmpty else { return }
        viewModel.removeTags(parsedTags)
        tagText = ""
    }
}

private struct SelectionProperties: View {
    let items: [MediaItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Properties")
                .font(.subheadline.weight(.semibold))

            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 6) {
                propertyRow("Items", items.count.formatted())
                propertyRow(
                    "Size",
                    ByteCountFormatter.string(
                        fromByteCount: items.reduce(0) { $0 + $1.sizeBytes },
                        countStyle: .file
                    )
                )

                if let item = items.only {
                    propertyRow("Workspace", item.workspace)
                    propertyRow("Project", item.project)
                    propertyRow("Type", item.bucket.rawValue.capitalized)
                    propertyRow(
                        "Entity",
                        ProjectPresentation.entityLabel(item.entity)
                    )
                    propertyRow(
                        "Cost",
                        ProjectPresentation.spendLabel(item.generation?.costUSD),
                        monospaced: true
                    )
                    if let createdAt = item.createdAt {
                        propertyRow(
                            "Created",
                            createdAt.formatted(date: .abbreviated, time: .shortened)
                        )
                    }
                    if let modifiedAt = item.modifiedAt {
                        propertyRow(
                            "Modified",
                            modifiedAt.formatted(date: .abbreviated, time: .shortened)
                        )
                    }
                }
            }
            .font(.caption)
        }
    }

    private func propertyRow(
        _ label: String,
        _ value: String,
        monospaced: Bool = false
    ) -> some View {
        GridRow {
            Text(label)
                .foregroundStyle(.secondary)
            Text(value)
                .fontDesign(monospaced ? .monospaced : .default)
                .lineLimit(2)
                .truncationMode(.middle)
                .textSelection(.enabled)
        }
    }
}

private func inspectorVerdictColor(_ verdict: ReviewVerdict) -> Color {
    switch verdict {
    case .unreviewed: RalphyTheme.secondaryText
    case .keep: RalphyTheme.approved
    case .maybe, .needsWork: RalphyTheme.amber
    case .reject: RalphyTheme.rejected
    }
}

private extension Collection {
    var only: Element? {
        count == 1 ? first : nil
    }
}
