import RalphyMediaCore
import SwiftUI

struct SidebarView: View {
    @ObservedObject var viewModel: LibraryViewModel

    var body: some View {
        List(selection: selection) {
            Section("Smart Filters") {
                sourceRow(
                    "All",
                    symbol: "square.grid.2x2",
                    count: viewModel.items.count
                )
                .tag(LibrarySmartSource.all)
                sourceRow(
                    "Usable",
                    symbol: "checkmark.seal",
                    count: viewModel.items.count - viewModel.count(for: .reject)
                )
                .tag(LibrarySmartSource.usable)
                sourceRow(
                    "Unreviewed",
                    symbol: "circle",
                    count: viewModel.count(for: .unreviewed)
                )
                .tag(LibrarySmartSource.verdict(.unreviewed))
                sourceRow(
                    "Keep",
                    symbol: "checkmark.circle",
                    count: viewModel.count(for: .keep)
                )
                .tag(LibrarySmartSource.verdict(.keep))
                sourceRow(
                    "Maybe",
                    symbol: "questionmark.circle",
                    count: viewModel.count(for: .maybe)
                )
                .tag(LibrarySmartSource.verdict(.maybe))
                sourceRow(
                    "Reject",
                    symbol: "xmark.circle",
                    count: viewModel.count(for: .reject)
                )
                .tag(LibrarySmartSource.verdict(.reject))
                sourceRow(
                    "Favorites",
                    symbol: "star",
                    count: viewModel.favoriteCount
                )
                .tag(LibrarySmartSource.favorites)
            }

            if !viewModel.workspaces.isEmpty {
                Section("Workspaces") {
                    ForEach(viewModel.workspaces, id: \.0) { workspace, count in
                        sourceRow(workspace, symbol: "externaldrive", count: count)
                            .tag(LibrarySmartSource.workspace(workspace))
                    }
                }
            }

            if !viewModel.projects.isEmpty {
                Section("Projects") {
                    ForEach(viewModel.projects, id: \.0) { project, count in
                        sourceRow(project, symbol: "folder", count: count)
                            .tag(LibrarySmartSource.project(project))
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let root = viewModel.rootURL {
                Text(root.path)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.bar)
                    .accessibilityLabel("Library path \(root.path)")
            }
        }
        .navigationTitle("Ralphy Media")
    }

    private var selection: Binding<LibrarySmartSource?> {
        Binding(
            get: { viewModel.selectedSource },
            set: { source in
                guard let source else { return }
                viewModel.applySource(source)
            }
        )
    }

    private func sourceRow(
        _ title: String,
        symbol: String,
        count: Int
    ) -> some View {
        Label {
            HStack(spacing: 6) {
                Text(title)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Text(count, format: .number)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
        } icon: {
            Image(systemName: symbol)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title), \(count) files")
    }

}
