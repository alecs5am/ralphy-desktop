import RalphyMediaCore
import SwiftUI

struct SidebarView: View {
    @ObservedObject var viewModel: LibraryViewModel
    @State private var workspaceSearch = ""
    @State private var projectSearch = ""

    var body: some View {
        VStack(spacing: 0) {
            sidebarHeader
            Divider().overlay(RalphyTheme.divider)
            searchAndSort
            Divider().overlay(RalphyTheme.divider)

            ScrollView {
                LazyVStack(spacing: RalphyTheme.Spacing.xSmall) {
                    if showsProjects {
                        projectRows
                    } else {
                        workspaceRows
                    }
                }
                .padding(.horizontal, RalphyTheme.Spacing.medium)
                .padding(.vertical, RalphyTheme.Spacing.medium)
            }

            Divider().overlay(RalphyTheme.divider)
            libraryFooter
        }
        .background(RalphyTheme.sidebar)
        .foregroundStyle(RalphyTheme.primaryText)
        .navigationTitle("")
    }

    private var showsProjects: Bool {
        viewModel.selectedWorkspaceID != nil
    }

    private var sidebarHeader: some View {
        HStack(spacing: RalphyTheme.Spacing.small) {
            if showsProjects {
                Button {
                    viewModel.goBack()
                } label: {
                    Image(systemName: "chevron.left")
                        .frame(width: 20, height: 20)
                }
                .buttonStyle(.plain)
                .help("Back")
                .accessibilityLabel("Back")
            } else {
                Image(systemName: "film.stack")
                    .foregroundStyle(RalphyTheme.focus)
                    .accessibilityHidden(true)
            }

            VStack(alignment: .leading, spacing: 1) {
                Text(viewModel.selectedWorkspaceSummary?.name ?? "Ralphy")
                    .font(.system(size: 14, weight: .semibold))
                    .lineLimit(1)
                Text(showsProjects ? "Projects" : "Workspaces")
                    .font(.system(size: 11))
                    .foregroundStyle(RalphyTheme.secondaryText)
            }

            Spacer(minLength: RalphyTheme.Spacing.small)

            if viewModel.isLoadingCatalog {
                ProgressView()
                    .controlSize(.mini)
                    .accessibilityLabel("Loading workspace catalog")
            }
        }
        .padding(.horizontal, RalphyTheme.Spacing.large)
        .frame(height: 48)
    }

    private var searchAndSort: some View {
        VStack(spacing: RalphyTheme.Spacing.small) {
            TextField(
                showsProjects ? "Search projects" : "Search workspaces",
                text: showsProjects ? $projectSearch : $workspaceSearch
            )
            .textFieldStyle(.roundedBorder)
            .controlSize(.small)
            .accessibilityLabel(showsProjects ? "Search projects" : "Search workspaces")

            HStack(spacing: RalphyTheme.Spacing.small) {
                Text(showsProjects ? "Project list" : "Workspace list")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(RalphyTheme.secondaryText)
                Spacer()
                sortMenu
            }
            .frame(height: 20)
        }
        .padding(.horizontal, RalphyTheme.Spacing.medium)
        .padding(.vertical, RalphyTheme.Spacing.medium)
    }

    @ViewBuilder
    private var sortMenu: some View {
        if showsProjects {
            Menu {
                Picker("Project sort", selection: $viewModel.projectPresentationSort) {
                    ForEach(ProjectSortOption.allCases, id: \.self) { option in
                        Text(option.label).tag(option)
                    }
                }
            } label: {
                Label(
                    viewModel.projectPresentationSort.label,
                    systemImage: "arrow.up.arrow.down"
                )
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .accessibilityLabel("Project sort: \(viewModel.projectPresentationSort.label)")
        } else {
            Menu {
                Picker("Workspace sort", selection: $viewModel.workspacePresentationSort) {
                    ForEach(WorkspaceSortOption.allCases, id: \.self) { option in
                        Text(option.label).tag(option)
                    }
                }
            } label: {
                Label(
                    viewModel.workspacePresentationSort.label,
                    systemImage: "arrow.up.arrow.down"
                )
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .accessibilityLabel(
                "Workspace sort: \(viewModel.workspacePresentationSort.label)"
            )
        }
    }

    @ViewBuilder
    private var workspaceRows: some View {
        let workspaces = WorkspacePresentation.sorted(
            viewModel.workspaceSummaries.filter { workspace in
                matchesWorkspaceSearch(workspace)
            },
            by: viewModel.workspacePresentationSort,
            pinned: viewModel.pinnedWorkspaceIDs
        )
        if workspaces.isEmpty {
            SidebarEmptyState(
                title: workspaceSearch.isEmpty ? "No workspaces" : "No matches",
                symbol: "square.stack.3d.up.slash"
            )
        } else {
            ForEach(workspaces) { workspace in
                Button {
                    viewModel.enterWorkspace(workspace.id)
                } label: {
                    WorkspaceSidebarRow(
                        workspace: workspace,
                        pinned: viewModel.pinnedWorkspaceIDs.contains(workspace.id)
                    )
                }
                .buttonStyle(.plain)
                .contextMenu {
                    Button(
                        viewModel.pinnedWorkspaceIDs.contains(workspace.id)
                            ? "Unpin Workspace"
                            : "Pin Workspace",
                        systemImage: viewModel.pinnedWorkspaceIDs.contains(workspace.id)
                            ? "pin.slash"
                            : "pin"
                    ) {
                        viewModel.toggleWorkspacePin(workspace.id)
                    }
                }
                .accessibilityLabel(
                    "\(workspace.name), \(workspace.projectCount) projects, " +
                        WorkspacePresentation.activityDescription(workspace.lastActivityAt)
                )
            }
        }
    }

    @ViewBuilder
    private var projectRows: some View {
        let projects = ProjectPresentation.sorted(
            viewModel.projectSummaries.filter { project in
                matchesProjectSearch(project)
            },
            by: viewModel.projectPresentationSort,
            pinned: viewModel.pinnedProjectIDs
        )
        if projects.isEmpty {
            SidebarEmptyState(
                title: projectSearch.isEmpty ? "No projects" : "No matches",
                symbol: "folder.badge.questionmark"
            )
        } else {
            ForEach(projects) { project in
                let selected = viewModel.selectedProjectReference == project.id
                Button {
                    viewModel.enterProject(project.id)
                } label: {
                    ProjectSidebarRow(
                        project: project,
                        pinned: viewModel.pinnedProjectIDs.contains(project.id),
                        selected: selected,
                        spend: selected
                            ? viewModel.projectSpendUSD ?? project.knownSpendUSD
                            : project.knownSpendUSD
                    )
                }
                .buttonStyle(.plain)
                .contextMenu {
                    Button(
                        viewModel.pinnedProjectIDs.contains(project.id)
                            ? "Unpin Project"
                            : "Pin Project",
                        systemImage: viewModel.pinnedProjectIDs.contains(project.id)
                            ? "pin.slash"
                            : "pin"
                    ) {
                        viewModel.toggleProjectPin(project.id)
                    }
                }
                .accessibilityLabel(
                    "\(project.name), \(ProjectPresentation.phaseLabel(project.phase)), " +
                        WorkspacePresentation.activityDescription(project.lastActivityAt)
                )
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
    }

    private var libraryFooter: some View {
        HStack(spacing: RalphyTheme.Spacing.medium) {
            if let root = viewModel.rootURL {
                Text(root.path)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(RalphyTheme.secondaryText)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                    .accessibilityLabel("Library path \(root.path)")
            } else {
                Text("No library selected")
                    .font(.system(size: 11))
                    .foregroundStyle(RalphyTheme.secondaryText)
            }
            Spacer(minLength: RalphyTheme.Spacing.small)
            Button {
                viewModel.pickLibrary()
            } label: {
                Image(systemName: "folder.badge.plus")
                    .frame(width: 22, height: 22)
            }
            .buttonStyle(.plain)
            .help("Choose .ralphy Library")
            .accessibilityLabel("Choose .ralphy library")
        }
        .padding(.horizontal, RalphyTheme.Spacing.large)
        .frame(height: 38)
    }

    private func matchesWorkspaceSearch(_ workspace: WorkspaceSummary) -> Bool {
        workspaceSearch.isEmpty
            || workspace.name.localizedCaseInsensitiveContains(workspaceSearch)
            || workspace.id.localizedCaseInsensitiveContains(workspaceSearch)
    }

    private func matchesProjectSearch(_ project: ProjectSummary) -> Bool {
        projectSearch.isEmpty
            || project.name.localizedCaseInsensitiveContains(projectSearch)
            || project.id.projectID.localizedCaseInsensitiveContains(projectSearch)
            || project.brief?.localizedCaseInsensitiveContains(projectSearch) == true
    }
}

private struct WorkspaceSidebarRow: View {
    let workspace: WorkspaceSummary
    let pinned: Bool

    var body: some View {
        HStack(spacing: RalphyTheme.Spacing.medium) {
            Image(systemName: "square.stack.3d.up")
                .font(.system(size: 12))
                .foregroundStyle(RalphyTheme.secondaryText)
                .frame(width: 16)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: RalphyTheme.Spacing.xSmall) {
                    Text(workspace.name)
                        .font(.system(size: 13, weight: .medium))
                        .lineLimit(1)
                    if pinned {
                        Image(systemName: "pin.fill")
                            .font(.system(size: 8))
                            .foregroundStyle(RalphyTheme.focus)
                            .accessibilityHidden(true)
                    }
                }
                HStack(spacing: RalphyTheme.Spacing.small) {
                    Text("\(workspace.projectCount) projects")
                    Text(WorkspacePresentation.activityDescription(workspace.lastActivityAt))
                }
                .font(.system(size: 10))
                .foregroundStyle(RalphyTheme.secondaryText)
                .lineLimit(1)
            }
            Spacer(minLength: RalphyTheme.Spacing.xSmall)
        }
        .padding(.horizontal, RalphyTheme.Spacing.medium)
        .frame(minHeight: 38)
        .contentShape(Rectangle())
    }
}

private struct ProjectSidebarRow: View {
    let project: ProjectSummary
    let pinned: Bool
    let selected: Bool
    let spend: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: RalphyTheme.Spacing.xSmall) {
                Image(systemName: project.hasFinalRender ? "checkered.flag" : "folder")
                    .font(.system(size: 11))
                    .foregroundStyle(project.hasFinalRender ? RalphyTheme.approved : RalphyTheme.secondaryText)
                    .frame(width: 15)
                Text(project.name)
                    .font(.system(size: 13, weight: selected ? .semibold : .regular))
                    .lineLimit(1)
                Spacer(minLength: RalphyTheme.Spacing.xSmall)
                if pinned {
                    Image(systemName: "pin.fill")
                        .font(.system(size: 8))
                        .foregroundStyle(RalphyTheme.focus)
                        .accessibilityHidden(true)
                }
            }
            HStack(spacing: RalphyTheme.Spacing.small) {
                Text(ProjectPresentation.phaseLabel(project.phase))
                    .foregroundStyle(RalphyTheme.amber)
                Text(WorkspacePresentation.activityDescription(project.lastActivityAt))
                Spacer(minLength: RalphyTheme.Spacing.xSmall)
                Text(ProjectPresentation.spendLabel(spend))
                    .fontDesign(.monospaced)
            }
            .font(.system(size: 9.5))
            .foregroundStyle(RalphyTheme.secondaryText)
            .lineLimit(1)
        }
        .padding(.horizontal, RalphyTheme.Spacing.medium)
        .frame(minHeight: 42)
        .background(selected ? RalphyTheme.selectedRow : .clear)
        .overlay {
            RoundedRectangle(cornerRadius: RalphyTheme.Radius.medium)
                .stroke(selected ? RalphyTheme.focus : .clear, lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: RalphyTheme.Radius.medium))
        .contentShape(Rectangle())
    }
}

private struct SidebarEmptyState: View {
    let title: String
    let symbol: String

    var body: some View {
        Label(title, systemImage: symbol)
            .font(.system(size: 12))
            .foregroundStyle(RalphyTheme.secondaryText)
            .frame(maxWidth: .infinity, minHeight: 72)
            .accessibilityLabel(title)
    }
}
