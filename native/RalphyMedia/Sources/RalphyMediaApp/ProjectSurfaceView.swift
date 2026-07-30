import RalphyMediaCore
import SwiftUI

struct ProjectSurfaceView: View {
    @ObservedObject var viewModel: LibraryViewModel
    @ObservedObject var thumbnailStore: ThumbnailStore

    var body: some View {
        Group {
            if let project = viewModel.selectedProjectSummary {
                VStack(spacing: 0) {
                    ProjectHeaderView(
                        project: project,
                        spend: viewModel.projectSpendUSD,
                        isLoadingCosts: viewModel.isLoadingCosts
                    )
                    modePicker
                    Divider().overlay(RalphyTheme.divider)
                    if viewModel.query.mode == .overview {
                        ProjectOverviewView(viewModel: viewModel, project: project)
                    } else {
                        ProjectControlStrip(viewModel: viewModel)
                        Divider().overlay(RalphyTheme.divider)
                        MediaGridView(
                            viewModel: viewModel,
                            thumbnailStore: thumbnailStore
                        )
                    }
                }
            } else {
                ContentUnavailableView(
                    "Project Unavailable",
                    systemImage: "folder.badge.questionmark"
                )
            }
        }
        .background(RalphyTheme.canvas)
        .foregroundStyle(RalphyTheme.primaryText)
    }

    private var modePicker: some View {
        Picker(
            "Project mode",
            selection: Binding(
                get: { viewModel.query.mode },
                set: { viewModel.setProjectMode($0) }
            )
        ) {
            ForEach(ProjectMode.allCases, id: \.self) { mode in
                Text(ProjectPresentation.modeLabel(mode))
                    .tag(mode)
            }
        }
        .pickerStyle(.segmented)
        .controlSize(.small)
        .labelsHidden()
        .frame(maxWidth: 590)
        .padding(.horizontal, RalphyTheme.Spacing.xLarge)
        .frame(maxWidth: .infinity, minHeight: 42, alignment: .leading)
        .accessibilityLabel("Project mode")
    }
}

private struct ProjectHeaderView: View {
    let project: ProjectSummary
    let spend: Double?
    let isLoadingCosts: Bool

    var body: some View {
        HStack(spacing: RalphyTheme.Spacing.large) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: RalphyTheme.Spacing.small) {
                    Text(project.name)
                        .font(.system(size: 16, weight: .semibold))
                        .lineLimit(1)
                    Text(ProjectPresentation.phaseLabel(project.phase))
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(RalphyTheme.amber)
                }
                Text(project.brief ?? project.id.projectID)
                    .font(.system(size: 11))
                    .foregroundStyle(RalphyTheme.secondaryText)
                    .lineLimit(1)
            }

            Spacer(minLength: RalphyTheme.Spacing.large)

            Label(
                project.hasFinalRender ? "Final ready" : "In progress",
                systemImage: project.hasFinalRender ? "checkered.flag" : "clock"
            )
            .foregroundStyle(
                project.hasFinalRender ? RalphyTheme.approved : RalphyTheme.amber
            )

            Text(
                isLoadingCosts
                    ? "Indexing cost"
                    : ProjectPresentation.spendLabel(spend ?? project.knownSpendUSD)
            )
            .fontDesign(.monospaced)
            .foregroundStyle(RalphyTheme.amber)

            Text(WorkspacePresentation.activityDescription(project.lastActivityAt))
                .foregroundStyle(RalphyTheme.secondaryText)
        }
        .font(.system(size: 10))
        .padding(.horizontal, RalphyTheme.Spacing.xLarge)
        .frame(height: 50)
        .overlay(alignment: .bottom) {
            Divider().overlay(RalphyTheme.divider)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct ProjectControlStrip: View {
    @ObservedObject var viewModel: LibraryViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: RalphyTheme.Spacing.small) {
            WrappingControlLayout(spacing: RalphyTheme.Spacing.medium) {
                TextField("Search project files", text: $viewModel.searchText)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 190)
                    .accessibilityLabel("Search current project files")

                Menu {
                    Picker("Media type", selection: $viewModel.selectedBucket) {
                        Text("All types").tag(MediaBucket?.none)
                        ForEach(MediaBucket.allCases, id: \.self) { bucket in
                            Text(ProjectPresentation.bucketLabel(bucket))
                                .tag(Optional(bucket))
                        }
                    }
                } label: {
                    Label(
                        "Type: " + (
                            viewModel.selectedBucket.map(ProjectPresentation.bucketLabel)
                                ?? "All types"
                        ),
                        systemImage: "line.3.horizontal.decrease"
                    )
                }
                .accessibilityLabel(
                    "Media type: " + (
                        viewModel.selectedBucket.map(ProjectPresentation.bucketLabel)
                            ?? "All types"
                    )
                )

                Menu {
                    Picker("Review status", selection: $viewModel.selectedVerdict) {
                        Text("All review").tag(ReviewVerdict?.none)
                        ForEach(ReviewVerdict.allCases, id: \.self) { verdict in
                            Text(verdict.displayName).tag(Optional(verdict))
                        }
                    }
                } label: {
                    Label(
                        "Review: \(viewModel.selectedVerdict?.displayName ?? "All review")",
                        systemImage: "checkmark.circle"
                    )
                }
                .accessibilityLabel(
                    "Review status: \(viewModel.selectedVerdict?.displayName ?? "All review")"
                )

                Menu {
                    Picker(
                        "Sort",
                        selection: Binding(
                            get: { viewModel.query.sort },
                            set: { value in viewModel.updateQuery { $0.sort = value } }
                        )
                    ) {
                        ForEach(MediaSort.allCases, id: \.self) { sort in
                            Text(ProjectPresentation.mediaSortLabel(sort)).tag(sort)
                        }
                    }
                } label: {
                    Label(
                        "Sort: \(ProjectPresentation.mediaSortLabel(viewModel.query.sort))",
                        systemImage: "arrow.up.arrow.down"
                    )
                }
                .accessibilityLabel(
                    "Sort: \(ProjectPresentation.mediaSortLabel(viewModel.query.sort))"
                )

                Menu {
                    Picker(
                        "Group",
                        selection: Binding(
                            get: { viewModel.query.group },
                            set: { value in viewModel.updateQuery { $0.group = value } }
                        )
                    ) {
                        ForEach(MediaGroup.allCases, id: \.self) { group in
                            Text(ProjectPresentation.groupLabel(group)).tag(group)
                        }
                    }
                } label: {
                    Label(
                        "Group: \(ProjectPresentation.groupLabel(viewModel.query.group))",
                        systemImage: "square.stack.3d.up"
                    )
                }
                .accessibilityLabel(
                    "Group: \(ProjectPresentation.groupLabel(viewModel.query.group))"
                )

                Toggle(isOn: $viewModel.includeIntermediates) {
                    Label("Intermediates", systemImage: "shippingbox")
                }
                .toggleStyle(.checkbox)
                .fixedSize()

                HStack(spacing: RalphyTheme.Spacing.small) {
                    Image(systemName: "square.grid.3x3")
                        .accessibilityHidden(true)
                    Slider(value: $viewModel.gridSize, in: 120...320, step: 10)
                        .frame(width: 92)
                        .accessibilityLabel("Grid item size")
                    Text("Grid \(Int(viewModel.gridSize.rounded()))")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(RalphyTheme.secondaryText)
                        .frame(width: 54, alignment: .leading)
                }
                .fixedSize()
            }
            .controlSize(.small)

            Text(
                ProjectPresentation.filterSummary(
                    mode: viewModel.query.mode,
                    bucket: viewModel.query.bucket,
                    verdict: viewModel.query.verdict,
                    sort: viewModel.query.sort,
                    group: viewModel.query.group,
                    includesIntermediates: viewModel.includeIntermediates,
                    gridSize: viewModel.gridSize
                )
            )
            .font(.system(size: 10))
            .foregroundStyle(RalphyTheme.secondaryText)
            .lineLimit(2)
            .accessibilityLabel("Active filters")
        }
        .padding(.horizontal, RalphyTheme.Spacing.xLarge)
        .padding(.vertical, RalphyTheme.Spacing.medium)
        .background(RalphyTheme.sidebar.opacity(0.42))
    }
}

private struct WrappingControlLayout: Layout {
    let spacing: CGFloat

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) -> CGSize {
        let width = proposal.width ?? .greatestFiniteMagnitude
        let layout = measurements(for: subviews, width: width)
        return CGSize(
            width: proposal.width ?? layout.maximumWidth,
            height: layout.height
        )
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        var point = bounds.origin
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if point.x > bounds.minX, point.x + size.width > bounds.maxX {
                point.x = bounds.minX
                point.y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(
                at: point,
                anchor: .topLeading,
                proposal: ProposedViewSize(size)
            )
            point.x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }

    private func measurements(
        for subviews: Subviews,
        width: CGFloat
    ) -> (height: CGFloat, maximumWidth: CGFloat) {
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var height: CGFloat = 0
        var maximumWidth: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth > 0, rowWidth + size.width > width {
                height += rowHeight + spacing
                maximumWidth = max(maximumWidth, rowWidth - spacing)
                rowWidth = 0
                rowHeight = 0
            }
            rowWidth += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        height += rowHeight
        maximumWidth = max(maximumWidth, max(0, rowWidth - spacing))
        return (height, maximumWidth)
    }
}
