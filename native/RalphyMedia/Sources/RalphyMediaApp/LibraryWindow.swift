import QuickLook
import RalphyMediaCore
import SwiftUI

struct LibraryWindow: View {
    @ObservedObject var viewModel: LibraryViewModel
    @StateObject private var thumbnailStore = ThumbnailStore()

    var body: some View {
        NavigationSplitView {
            SidebarView(viewModel: viewModel)
                .navigationSplitViewColumnWidth(min: 250, ideal: 280, max: 320)
        } detail: {
            VStack(spacing: 0) {
                detailSurface
                LibraryStatusStrip(viewModel: viewModel)
            }
            .background(RalphyTheme.canvas)
        }
        .inspector(isPresented: inspectorPresented) {
            InspectorView(viewModel: viewModel)
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
        .disabled(viewModel.isTerminating)
    }

    @ViewBuilder
    private var detailSurface: some View {
        switch viewModel.route {
        case .library:
            LibraryDashboardView(viewModel: viewModel)
        case .workspace:
            WorkspaceDashboardView(viewModel: viewModel)
        case .project, .asset:
            ProjectSurfaceView(
                viewModel: viewModel,
                thumbnailStore: thumbnailStore
            )
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

    private var inspectorPresented: Binding<Bool> {
        Binding(
            get: {
                viewModel.selectedProjectReference != nil
                    && viewModel.inspectorVisible
            },
            set: { presented in
                guard viewModel.selectedProjectReference != nil else { return }
                viewModel.inspectorVisible = presented
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
        ToolbarItem(placement: .navigation) {
            if viewModel.route != .library {
                Button {
                    viewModel.goBack()
                } label: {
                    Label("Back", systemImage: "chevron.left")
                }
                .labelStyle(.iconOnly)
                .help("Back")
                .accessibilityLabel("Back")
            }
        }

        ToolbarItemGroup(placement: .primaryAction) {
            Button {
                viewModel.pickLibrary()
            } label: {
                Label("Choose Library", systemImage: "folder.badge.plus")
            }
            .labelStyle(.iconOnly)
            .help("Choose .ralphy Library")
            .accessibilityLabel("Choose .ralphy library")

            Toggle(isOn: $viewModel.inspectorVisible) {
                Label("Inspector", systemImage: "sidebar.right")
            }
            .toggleStyle(.button)
            .labelStyle(.iconOnly)
            .help("Show or Hide Inspector")
            .accessibilityLabel("Show or hide inspector")
            .disabled(viewModel.selectedProjectReference == nil)
        }
    }
}
