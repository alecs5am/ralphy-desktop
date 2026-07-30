import AppKit
import RalphyMediaCore
import SwiftUI

struct LibraryDashboardView: View {
    @ObservedObject var viewModel: LibraryViewModel

    var body: some View {
        Group {
            if viewModel.rootURL == nil, !viewModel.isLoadingCatalog {
                ContentUnavailableView {
                    Label("Open a Ralphy Library", systemImage: "folder")
                } description: {
                    Text("Choose a .ralphy directory to browse its workspaces.")
                } actions: {
                    Button("Choose Library") {
                        viewModel.pickLibrary()
                    }
                }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        DashboardHeader(
                            title: "Library",
                            detail: viewModel.rootURL?.lastPathComponent ?? ".ralphy",
                            activity: "\(viewModel.workspaceSummaries.count) workspaces"
                        )
                        catalogMetrics
                        DashboardSectionHeader(
                            title: "Recent workspaces",
                            detail: "Sorted by activity"
                        )
                        recentWorkspaces
                    }
                }
            }
        }
        .background(RalphyTheme.canvas)
        .foregroundStyle(RalphyTheme.primaryText)
        .overlay {
            if viewModel.isLoadingCatalog {
                ProgressView("Loading workspaces")
                    .controlSize(.small)
            }
        }
    }

    private var catalogMetrics: some View {
        HStack(spacing: 0) {
            DashboardMetric(
                value: viewModel.workspaceSummaries.count.formatted(),
                label: "Workspaces",
                symbol: "square.stack.3d.up"
            )
            DashboardMetric(
                value: projectCount.formatted(),
                label: "Projects",
                symbol: "folder"
            )
            DashboardMetric(
                value: sharedAssetCount.formatted(),
                label: "Shared assets",
                symbol: "photo.on.rectangle.angled"
            )
            DashboardMetric(
                value: unitCount.formatted(),
                label: "Units",
                symbol: "shippingbox"
            )
        }
        .padding(.horizontal, RalphyTheme.Spacing.xLarge)
        .frame(minHeight: 72)
        .overlay(alignment: .top) {
            Divider().overlay(RalphyTheme.divider)
        }
        .overlay(alignment: .bottom) {
            Divider().overlay(RalphyTheme.divider)
        }
    }

    @ViewBuilder
    private var recentWorkspaces: some View {
        let workspaces = WorkspacePresentation.sorted(
            viewModel.workspaceSummaries,
            by: .recent,
            pinned: viewModel.pinnedWorkspaceIDs
        )
        if workspaces.isEmpty, !viewModel.isLoadingCatalog {
            Text("No workspaces were found in this library.")
                .font(.system(size: 13))
                .foregroundStyle(RalphyTheme.secondaryText)
                .padding(RalphyTheme.Spacing.xLarge)
        } else {
            ForEach(workspaces.prefix(12)) { workspace in
                Button {
                    viewModel.enterWorkspace(workspace.id)
                } label: {
                    HStack(spacing: RalphyTheme.Spacing.large) {
                        Image(systemName: "square.stack.3d.up")
                            .foregroundStyle(RalphyTheme.secondaryText)
                            .frame(width: 18)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(workspace.name)
                                .font(.system(size: 13, weight: .medium))
                            if let description = workspace.description, !description.isEmpty {
                                Text(description)
                                    .font(.system(size: 11))
                                    .foregroundStyle(RalphyTheme.secondaryText)
                                    .lineLimit(1)
                            }
                        }
                        Spacer(minLength: RalphyTheme.Spacing.medium)
                        Text("\(workspace.projectCount) projects")
                            .font(.system(size: 11))
                            .foregroundStyle(RalphyTheme.secondaryText)
                        Text(WorkspacePresentation.activityDescription(workspace.lastActivityAt))
                            .font(.system(size: 11))
                            .foregroundStyle(RalphyTheme.secondaryText)
                            .frame(width: 76, alignment: .trailing)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 10))
                            .foregroundStyle(RalphyTheme.secondaryText)
                    }
                    .padding(.horizontal, RalphyTheme.Spacing.xLarge)
                    .frame(minHeight: 42)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Divider()
                    .overlay(RalphyTheme.divider)
                    .padding(.leading, 50)
            }
        }
    }

    private var projectCount: Int {
        viewModel.workspaceSummaries.reduce(0) { $0 + $1.projectCount }
    }

    private var sharedAssetCount: Int {
        viewModel.workspaceSummaries.reduce(0) { $0 + $1.sharedAssetCount }
    }

    private var unitCount: Int {
        viewModel.workspaceSummaries.reduce(0) { $0 + $1.unitCount }
    }
}

struct WorkspaceDashboardView: View {
    @ObservedObject var viewModel: LibraryViewModel

    var body: some View {
        Group {
            if let workspace = viewModel.selectedWorkspaceSummary {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        DashboardHeader(
                            title: workspace.name,
                            detail: workspace.description ?? workspace.id,
                            activity: WorkspacePresentation.activityDescription(
                                workspace.lastActivityAt
                            )
                        )
                        workspaceMetrics(workspace)
                        shortcutStrip(workspace)
                        DashboardSectionHeader(
                            title: "Recent projects",
                            detail: "\(projects.count) total"
                        )
                        recentProjects
                        DashboardSectionHeader(
                            title: "Production state",
                            detail: "\(finalCount) finals ready"
                        )
                        productionState
                    }
                }
            } else {
                ContentUnavailableView(
                    "Workspace Unavailable",
                    systemImage: "square.stack.3d.up.slash"
                )
            }
        }
        .background(RalphyTheme.canvas)
        .foregroundStyle(RalphyTheme.primaryText)
    }

    private func workspaceMetrics(_ workspace: WorkspaceSummary) -> some View {
        HStack(spacing: 0) {
            DashboardMetric(
                value: workspace.projectCount.formatted(),
                label: "Projects",
                symbol: "folder"
            )
            DashboardMetric(
                value: finalCount.formatted(),
                label: "Finals ready",
                symbol: "checkered.flag",
                emphasis: RalphyTheme.approved
            )
            DashboardMetric(
                value: ProjectPresentation.spendLabel(knownSpend),
                label: "Known spend",
                symbol: "dollarsign.circle",
                emphasis: RalphyTheme.amber,
                monospaced: true
            )
            DashboardMetric(
                value: activePhaseCount.formatted(),
                label: "Active phases",
                symbol: "point.topleft.down.curvedto.point.bottomright.up"
            )
        }
        .padding(.horizontal, RalphyTheme.Spacing.xLarge)
        .frame(minHeight: 72)
        .overlay(alignment: .top) {
            Divider().overlay(RalphyTheme.divider)
        }
        .overlay(alignment: .bottom) {
            Divider().overlay(RalphyTheme.divider)
        }
    }

    private func shortcutStrip(_ workspace: WorkspaceSummary) -> some View {
        HStack(spacing: RalphyTheme.Spacing.medium) {
            Text("Workspace files")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(RalphyTheme.secondaryText)
            Button {
                openWorkspaceFolder("shared")
            } label: {
                Label("\(workspace.sharedAssetCount) shared", systemImage: "photo.on.rectangle")
            }
            .buttonStyle(.borderless)
            Button {
                openWorkspaceFolder("units")
            } label: {
                Label("\(workspace.unitCount) units", systemImage: "shippingbox")
            }
            .buttonStyle(.borderless)
            Spacer()
        }
        .controlSize(.small)
        .padding(.horizontal, RalphyTheme.Spacing.xLarge)
        .frame(height: 38)
        .overlay(alignment: .bottom) {
            Divider().overlay(RalphyTheme.divider)
        }
    }

    @ViewBuilder
    private var recentProjects: some View {
        let recent = ProjectPresentation.sorted(
            projects,
            by: .recent,
            pinned: viewModel.pinnedProjectIDs
        )
        if recent.isEmpty {
            Text("No projects were found in this workspace.")
                .font(.system(size: 13))
                .foregroundStyle(RalphyTheme.secondaryText)
                .padding(RalphyTheme.Spacing.xLarge)
        } else {
            ForEach(recent.prefix(10)) { project in
                Button {
                    viewModel.enterProject(project.id)
                } label: {
                    ProjectDashboardRow(project: project)
                }
                .buttonStyle(.plain)
                Divider()
                    .overlay(RalphyTheme.divider)
                    .padding(.leading, 48)
            }
        }
    }

    private var productionState: some View {
        VStack(alignment: .leading, spacing: RalphyTheme.Spacing.medium) {
            ForEach(phaseCounts, id: \.phase) { entry in
                HStack(spacing: RalphyTheme.Spacing.medium) {
                    Text(ProjectPresentation.phaseLabel(entry.phase))
                        .font(.system(size: 11))
                        .frame(width: 84, alignment: .leading)
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            Rectangle().fill(RalphyTheme.divider)
                            Rectangle()
                                .fill(RalphyTheme.amber)
                                .frame(
                                    width: geometry.size.width
                                        * CGFloat(entry.count)
                                        / CGFloat(max(1, projects.count))
                                )
                        }
                    }
                    .frame(height: 3)
                    Text(entry.count, format: .number)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(RalphyTheme.secondaryText)
                        .frame(width: 22, alignment: .trailing)
                }
            }
        }
        .padding(.horizontal, RalphyTheme.Spacing.xLarge)
        .padding(.bottom, RalphyTheme.Spacing.xLarge)
    }

    private var projects: [ProjectSummary] {
        viewModel.projectSummaries
    }

    private var finalCount: Int {
        projects.count(where: \.hasFinalRender)
    }

    private var knownSpend: Double? {
        let values = projects.compactMap(\.knownSpendUSD)
        return values.isEmpty ? nil : values.reduce(0, +)
    }

    private var activePhaseCount: Int {
        Set(projects.map(\.phase).filter { $0 != .complete && $0 != .unknown }).count
    }

    private var phaseCounts: [(phase: ProjectPhase, count: Int)] {
        let counts = Dictionary(grouping: projects, by: \.phase).mapValues(\.count)
        return ProjectPhase.allCases.compactMap { phase in
            counts[phase].map { (phase, $0) }
        }
    }

    private func openWorkspaceFolder(_ component: String) {
        guard let root = viewModel.rootURL,
              let workspaceID = viewModel.selectedWorkspaceID else {
            return
        }
        NSWorkspace.shared.open(
            root.appending(path: "workspaces/\(workspaceID)/\(component)")
        )
    }
}

private struct DashboardHeader: View {
    let title: String
    let detail: String
    let activity: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: RalphyTheme.Spacing.large) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 20, weight: .semibold))
                    .lineLimit(1)
                Text(detail)
                    .font(.system(size: 11))
                    .foregroundStyle(RalphyTheme.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: RalphyTheme.Spacing.medium)
            Text(activity)
                .font(.system(size: 11))
                .foregroundStyle(RalphyTheme.secondaryText)
                .lineLimit(1)
        }
        .padding(.horizontal, RalphyTheme.Spacing.xLarge)
        .frame(height: 62)
    }
}

private struct DashboardMetric: View {
    let value: String
    let label: String
    let symbol: String
    var emphasis = RalphyTheme.primaryText
    var monospaced = false

    var body: some View {
        HStack(spacing: RalphyTheme.Spacing.medium) {
            Image(systemName: symbol)
                .font(.system(size: 12))
                .foregroundStyle(emphasis)
                .frame(width: 16)
            VStack(alignment: .leading, spacing: 2) {
                Text(value)
                    .font(
                        .system(
                            size: 14,
                            weight: .semibold,
                            design: monospaced ? .monospaced : .default
                        )
                    )
                    .foregroundStyle(emphasis)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                Text(label)
                    .font(.system(size: 10))
                    .foregroundStyle(RalphyTheme.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: RalphyTheme.Spacing.medium)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, RalphyTheme.Spacing.medium)
        .overlay(alignment: .trailing) {
            Rectangle()
                .fill(RalphyTheme.divider)
                .frame(width: 1, height: 38)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct DashboardSectionHeader: View {
    let title: String
    let detail: String

    var body: some View {
        HStack {
            Text(title)
                .font(.system(size: 12, weight: .semibold))
            Spacer()
            Text(detail)
                .font(.system(size: 10))
                .foregroundStyle(RalphyTheme.secondaryText)
        }
        .padding(.horizontal, RalphyTheme.Spacing.xLarge)
        .frame(height: 38)
        .background(RalphyTheme.sidebar.opacity(0.55))
        .overlay(alignment: .bottom) {
            Divider().overlay(RalphyTheme.divider)
        }
    }
}

private struct ProjectDashboardRow: View {
    let project: ProjectSummary

    var body: some View {
        HStack(spacing: RalphyTheme.Spacing.large) {
            Image(systemName: project.hasFinalRender ? "checkered.flag" : "folder")
                .foregroundStyle(project.hasFinalRender ? RalphyTheme.approved : RalphyTheme.secondaryText)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(project.name)
                    .font(.system(size: 13, weight: .medium))
                    .lineLimit(1)
                Text(project.brief ?? project.id.projectID)
                    .font(.system(size: 10))
                    .foregroundStyle(RalphyTheme.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: RalphyTheme.Spacing.medium)
            Text(ProjectPresentation.phaseLabel(project.phase))
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(RalphyTheme.amber)
                .frame(width: 76, alignment: .leading)
            Text(ProjectPresentation.spendLabel(project.knownSpendUSD))
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(RalphyTheme.secondaryText)
                .frame(width: 112, alignment: .trailing)
            Text(WorkspacePresentation.activityDescription(project.lastActivityAt))
                .font(.system(size: 10))
                .foregroundStyle(RalphyTheme.secondaryText)
                .frame(width: 68, alignment: .trailing)
            Image(systemName: "chevron.right")
                .font(.system(size: 10))
                .foregroundStyle(RalphyTheme.secondaryText)
        }
        .padding(.horizontal, RalphyTheme.Spacing.xLarge)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
