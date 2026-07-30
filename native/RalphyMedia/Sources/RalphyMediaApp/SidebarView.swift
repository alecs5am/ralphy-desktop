import RalphyMediaCore
import SwiftUI

struct SidebarView: View {
    private enum Source: Hashable {
        case all
        case verdict(ReviewVerdict)
        case favorites
        case workspace(String)
        case project(String)
    }

    @ObservedObject var viewModel: LibraryViewModel

    var body: some View {
        List(selection: selection) {
            Section("Smart Filters") {
                sourceRow(
                    "All",
                    symbol: "square.grid.2x2",
                    count: viewModel.items.count
                )
                .tag(Source.all)
                sourceRow(
                    "Unreviewed",
                    symbol: "circle",
                    count: viewModel.count(for: .unreviewed)
                )
                .tag(Source.verdict(.unreviewed))
                sourceRow(
                    "Keep",
                    symbol: "checkmark.circle",
                    count: viewModel.count(for: .keep)
                )
                .tag(Source.verdict(.keep))
                sourceRow(
                    "Maybe",
                    symbol: "questionmark.circle",
                    count: viewModel.count(for: .maybe)
                )
                .tag(Source.verdict(.maybe))
                sourceRow(
                    "Reject",
                    symbol: "xmark.circle",
                    count: viewModel.count(for: .reject)
                )
                .tag(Source.verdict(.reject))
                sourceRow(
                    "Favorites",
                    symbol: "star",
                    count: viewModel.favoriteCount
                )
                .tag(Source.favorites)
            }

            if !viewModel.workspaces.isEmpty {
                Section("Workspaces") {
                    ForEach(viewModel.workspaces, id: \.0) { workspace, count in
                        sourceRow(workspace, symbol: "externaldrive", count: count)
                            .tag(Source.workspace(workspace))
                    }
                }
            }

            if !viewModel.projects.isEmpty {
                Section("Projects") {
                    ForEach(viewModel.projects, id: \.0) { project, count in
                        sourceRow(project, symbol: "folder", count: count)
                            .tag(Source.project(project))
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

    private var selection: Binding<Source?> {
        Binding(
            get: {
                if let project = viewModel.selectedProject {
                    return .project(project)
                }
                if let workspace = viewModel.selectedWorkspace {
                    return .workspace(workspace)
                }
                if viewModel.favoriteOnly {
                    return .favorites
                }
                if let verdict = viewModel.selectedVerdict {
                    return .verdict(verdict)
                }
                return .all
            },
            set: { source in
                guard let source else { return }
                apply(source)
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

    private func apply(_ source: Source) {
        switch source {
        case .all:
            viewModel.selectedWorkspace = nil
            viewModel.selectedProject = nil
            viewModel.selectedVerdict = nil
            viewModel.favoriteOnly = false
            viewModel.showRejected = true
        case let .verdict(verdict):
            viewModel.selectedWorkspace = nil
            viewModel.selectedProject = nil
            viewModel.selectedVerdict = verdict
            viewModel.favoriteOnly = false
            viewModel.showRejected = true
        case .favorites:
            viewModel.selectedWorkspace = nil
            viewModel.selectedProject = nil
            viewModel.selectedVerdict = nil
            viewModel.favoriteOnly = true
            viewModel.showRejected = true
        case let .workspace(workspace):
            viewModel.selectedWorkspace = workspace
            viewModel.selectedProject = nil
            viewModel.selectedVerdict = nil
            viewModel.favoriteOnly = false
            viewModel.showRejected = true
        case let .project(project):
            viewModel.selectedProject = project
            viewModel.selectedVerdict = nil
            viewModel.favoriteOnly = false
            viewModel.showRejected = true
        }
    }
}
