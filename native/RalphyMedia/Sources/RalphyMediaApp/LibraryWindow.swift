import QuickLook
import RalphyMediaCore
import SwiftUI

struct LibraryWindow: View {
    @ObservedObject var viewModel: LibraryViewModel
    @StateObject private var thumbnailStore = ThumbnailStore()

    var body: some View {
        NavigationSplitView {
            SidebarView(viewModel: viewModel)
                .navigationSplitViewColumnWidth(min: 180, ideal: 210, max: 260)
        } detail: {
            VStack(spacing: 0) {
                MediaGridView(
                    viewModel: viewModel,
                    thumbnailStore: thumbnailStore
                )
                LibraryStatusStrip(viewModel: viewModel)
            }
        }
        .inspector(isPresented: $viewModel.inspectorVisible) {
            InspectorView(
                viewModel: viewModel,
                thumbnailStore: thumbnailStore
            )
        }
        .toolbar {
            LibraryToolbar(viewModel: viewModel)
        }
        .quickLookPreview(quickLookSelection)
        .confirmationDialog(
            "Move Files to Trash?",
            isPresented: trashConfirmation,
            titleVisibility: .visible
        ) {
            Button("Move to Trash", role: .destructive) {
                viewModel.confirmTrash()
            }
            Button("Cancel", role: .cancel) {
                viewModel.cancelTrash()
            }
        } message: {
            Text(trashMessage)
        }
        .alert("Ralphy Media", isPresented: errorPresented) {
            Button("OK", role: .cancel) {
                viewModel.errorMessage = nil
            }
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
        .onAppear {
            viewModel.restoreLastLibrary()
        }
    }

    private var quickLookSelection: Binding<URL?> {
        Binding(
            get: { viewModel.quickLookURL },
            set: { url in
                if url == nil {
                    viewModel.clearQuickLook()
                }
            }
        )
    }

    private var trashConfirmation: Binding<Bool> {
        Binding(
            get: { viewModel.pendingTrashConfirmation != nil },
            set: { presented in
                if !presented, viewModel.pendingTrashConfirmation != nil {
                    viewModel.cancelTrash()
                }
            }
        )
    }

    private var errorPresented: Binding<Bool> {
        Binding(
            get: { viewModel.errorMessage != nil },
            set: { presented in
                if !presented {
                    viewModel.errorMessage = nil
                }
            }
        )
    }

    private var trashMessage: String {
        let count = viewModel.pendingTrashConfirmation?.count ?? 0
        return "\(count) \(count == 1 ? "file" : "files") will be moved to the macOS Trash."
    }
}

private struct LibraryToolbar: ToolbarContent {
    @ObservedObject var viewModel: LibraryViewModel

    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            Button {
                viewModel.pickLibrary()
            } label: {
                Label("Choose Library", systemImage: "folder.badge.plus")
            }
            .labelStyle(.iconOnly)
            .help("Choose .ralphy Library")
            .accessibilityLabel("Choose .ralphy library")

            TextField("Search", text: $viewModel.searchText)
                .textFieldStyle(.roundedBorder)
                .frame(minWidth: 150, idealWidth: 220, maxWidth: 280)
                .accessibilityLabel("Search media")

            Menu {
                Picker("Media Type", selection: $viewModel.selectedBucket) {
                    Text("All Types").tag(MediaBucket?.none)
                    ForEach(MediaBucket.allCases, id: \.self) { bucket in
                        Text(bucket.rawValue.capitalized)
                            .tag(Optional(bucket))
                    }
                }
            } label: {
                Label("Media Type", systemImage: "line.3.horizontal.decrease")
            }
            .labelStyle(.iconOnly)
            .help("Filter by Media Type")
            .accessibilityLabel("Filter by media type")

            Menu {
                Picker("Sort", selection: Binding(
                    get: { viewModel.query.sort },
                    set: { viewModel.query.sort = $0 }
                )) {
                    Text("Name").tag(MediaSort.name)
                    Text("Newest").tag(MediaSort.newest)
                    Text("Oldest").tag(MediaSort.oldest)
                }
            } label: {
                Label("Sort", systemImage: "arrow.up.arrow.down")
            }
            .labelStyle(.iconOnly)
            .help("Sort")
            .accessibilityLabel("Sort media")

            Menu {
                Picker("Group", selection: Binding(
                    get: { viewModel.query.group },
                    set: { viewModel.query.group = $0 }
                )) {
                    Text("None").tag(MediaGroup.none)
                    Text("Workspace").tag(MediaGroup.workspace)
                    Text("Project").tag(MediaGroup.project)
                    Text("Type").tag(MediaGroup.type)
                }
            } label: {
                Label("Group", systemImage: "square.stack.3d.up")
            }
            .labelStyle(.iconOnly)
            .help("Group")
            .accessibilityLabel("Group media")

            Toggle(isOn: $viewModel.includeIntermediates) {
                Label("Include Intermediates", systemImage: "shippingbox")
            }
            .toggleStyle(.button)
            .labelStyle(.iconOnly)
            .help("Include Intermediate Files")
            .accessibilityLabel("Include intermediate files")

            HStack(spacing: 6) {
                Image(systemName: "square.grid.3x3")
                    .accessibilityHidden(true)
                Slider(value: $viewModel.gridSize, in: 120...320, step: 10)
                    .frame(width: 110)
                    .accessibilityLabel("Grid item size")
                Image(systemName: "square.grid.2x2")
                    .accessibilityHidden(true)
            }

            Toggle(isOn: $viewModel.inspectorVisible) {
                Label("Inspector", systemImage: "sidebar.right")
            }
            .toggleStyle(.button)
            .labelStyle(.iconOnly)
            .help("Show or Hide Inspector")
            .accessibilityLabel("Show or hide inspector")
        }
    }
}
