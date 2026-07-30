import RalphyMediaCore
import SwiftUI

struct ProjectOverviewView: View {
    @ObservedObject var viewModel: LibraryViewModel
    let project: ProjectSummary

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 0) {
                    OverviewMetric(
                        value: ProjectPresentation.phaseLabel(project.phase),
                        label: "Lifecycle",
                        symbol: "point.topleft.down.curvedto.point.bottomright.up",
                        emphasis: RalphyTheme.amber
                    )
                    OverviewMetric(
                        value: outputLabel,
                        label: "Output",
                        symbol: "checkered.flag",
                        emphasis: project.hasFinalRender
                            ? RalphyTheme.approved
                            : RalphyTheme.secondaryText
                    )
                    OverviewMetric(
                        value: spendLabel,
                        label: "Generation spend",
                        symbol: "dollarsign.circle",
                        emphasis: RalphyTheme.amber,
                        monospaced: true
                    )
                    OverviewMetric(
                        value: viewModel.items.count.formatted(),
                        label: "Indexed files",
                        symbol: "doc.on.doc"
                    )
                }
                .frame(minHeight: 72)
                .padding(.horizontal, RalphyTheme.Spacing.xLarge)
                .overlay(alignment: .bottom) {
                    Divider().overlay(RalphyTheme.divider)
                }

                ProjectOverviewSectionHeader(
                    title: "Next step",
                    detail: project.status ?? "Derived from project state"
                )
                HStack(alignment: .firstTextBaseline, spacing: RalphyTheme.Spacing.large) {
                    Image(systemName: nextStepSymbol)
                        .foregroundStyle(RalphyTheme.amber)
                        .frame(width: 18)
                    Text(nextStep)
                        .font(.system(size: 13, weight: .medium))
                    Spacer()
                    Text(WorkspacePresentation.activityDescription(project.lastActivityAt))
                        .font(.system(size: 11))
                        .foregroundStyle(RalphyTheme.secondaryText)
                }
                .padding(.horizontal, RalphyTheme.Spacing.xLarge)
                .frame(minHeight: 46)

                ProjectOverviewSectionHeader(
                    title: "Project contents",
                    detail: "\(viewModel.items.count) files"
                )
                entitySummary

                ProjectOverviewSectionHeader(
                    title: "Recent generation outputs",
                    detail: "\(recentGenerationItems.count) attributed"
                )
                recentGenerations

                ProjectOverviewSectionHeader(
                    title: "Key documents",
                    detail: "\(keyDocuments.count) lifecycle files"
                )
                keyDocumentRows
            }
        }
        .background(RalphyTheme.canvas)
    }

    private var entitySummary: some View {
        VStack(spacing: 0) {
            ForEach(RalphyEntityKind.allCases, id: \.self) { entity in
                let count = viewModel.items.count { $0.entity == entity }
                Button {
                    viewModel.setProjectMode(ProjectPresentation.mode(for: entity))
                } label: {
                    HStack(spacing: RalphyTheme.Spacing.large) {
                        Image(systemName: ProjectPresentation.entitySymbol(entity))
                            .foregroundStyle(RalphyTheme.secondaryText)
                            .frame(width: 18)
                        Text(ProjectPresentation.entityLabel(entity))
                            .font(.system(size: 12))
                        Spacer()
                        Text(count, format: .number)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(RalphyTheme.secondaryText)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 9))
                            .foregroundStyle(RalphyTheme.secondaryText)
                    }
                    .padding(.horizontal, RalphyTheme.Spacing.xLarge)
                    .frame(minHeight: 34)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Divider()
                    .overlay(RalphyTheme.divider)
                    .padding(.leading, 50)
            }
        }
    }

    @ViewBuilder
    private var recentGenerations: some View {
        if recentGenerationItems.isEmpty {
            OverviewPlaceholder(text: "No attributed generation outputs are indexed.")
        } else {
            ForEach(recentGenerationItems.prefix(6)) { item in
                Button {
                    viewModel.setProjectMode(ProjectPresentation.mode(for: item.entity))
                    viewModel.select(item)
                } label: {
                    HStack(spacing: RalphyTheme.Spacing.large) {
                        Image(systemName: ProjectPresentation.entitySymbol(item.entity))
                            .foregroundStyle(RalphyTheme.focus)
                            .frame(width: 18)
                        Text(item.filename)
                            .font(.system(size: 12))
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer()
                        if let generatedAt = item.generation?.generatedAt {
                            Text(WorkspacePresentation.activityDescription(generatedAt))
                                .font(.system(size: 10))
                                .foregroundStyle(RalphyTheme.secondaryText)
                        }
                        Text(ProjectPresentation.spendLabel(item.generation?.costUSD))
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(RalphyTheme.amber)
                    }
                    .padding(.horizontal, RalphyTheme.Spacing.xLarge)
                    .frame(minHeight: 34)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Divider()
                    .overlay(RalphyTheme.divider)
                    .padding(.leading, 50)
            }
        }
    }

    @ViewBuilder
    private var keyDocumentRows: some View {
        if keyDocuments.isEmpty {
            OverviewPlaceholder(text: "No lifecycle documents are indexed.")
        } else {
            ForEach(keyDocuments.prefix(8)) { item in
                Button {
                    viewModel.setProjectMode(.files)
                    viewModel.select(item)
                } label: {
                    HStack(spacing: RalphyTheme.Spacing.large) {
                        Image(systemName: "doc.text")
                            .foregroundStyle(RalphyTheme.secondaryText)
                            .frame(width: 18)
                        Text(item.filename)
                            .font(.system(size: 12))
                            .lineLimit(1)
                        Spacer()
                        Text(WorkspacePresentation.activityDescription(item.modifiedAt))
                            .font(.system(size: 10))
                            .foregroundStyle(RalphyTheme.secondaryText)
                    }
                    .padding(.horizontal, RalphyTheme.Spacing.xLarge)
                    .frame(minHeight: 34)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Divider()
                    .overlay(RalphyTheme.divider)
                    .padding(.leading, 50)
            }
        }
    }

    private var recentGenerationItems: [MediaItem] {
        viewModel.items
            .filter { $0.generation != nil }
            .sorted {
                ($0.generation?.generatedAt ?? $0.modifiedAt ?? .distantPast)
                    > ($1.generation?.generatedAt ?? $1.modifiedAt ?? .distantPast)
            }
    }

    private var keyDocuments: [MediaItem] {
        viewModel.items
            .filter { $0.entity == .lifecycleDocument }
            .sorted {
                ($0.modifiedAt ?? .distantPast) > ($1.modifiedAt ?? .distantPast)
            }
    }

    private var outputLabel: String {
        project.hasFinalRender ? "Final ready" : "In progress"
    }

    private var spendLabel: String {
        if viewModel.isLoadingCosts {
            return "Indexing cost"
        }
        return ProjectPresentation.spendLabel(
            viewModel.projectSpendUSD ?? project.knownSpendUSD
        )
    }

    private var nextStep: String {
        switch project.phase {
        case .brief: "Define the visual style"
        case .style: "Build the production plan"
        case .plan: "Write the scenario"
        case .scenario: "Prepare prompts"
        case .prompts: "Generate source assets"
        case .assets: "Assemble the render"
        case .render: "Evaluate the current output"
        case .evaluation: "Repair review findings"
        case .repair: "Render and evaluate again"
        case .unit: "Package reusable units"
        case .postmortem: "Capture production learnings"
        case .complete: "Review or publish the final"
        case .unknown: "Open the brief and establish project state"
        }
    }

    private var nextStepSymbol: String {
        project.phase == .complete ? "checkmark.circle" : "arrow.right.circle"
    }
}

private struct OverviewMetric: View {
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
                            size: 13,
                            weight: .semibold,
                            design: monospaced ? .monospaced : .default
                        )
                    )
                    .foregroundStyle(emphasis)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
                Text(label)
                    .font(.system(size: 10))
                    .foregroundStyle(RalphyTheme.secondaryText)
                    .lineLimit(1)
            }
            Spacer(minLength: RalphyTheme.Spacing.small)
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

private struct ProjectOverviewSectionHeader: View {
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
                .lineLimit(1)
        }
        .padding(.horizontal, RalphyTheme.Spacing.xLarge)
        .frame(height: 38)
        .background(RalphyTheme.sidebar.opacity(0.55))
        .overlay(alignment: .top) {
            Divider().overlay(RalphyTheme.divider)
        }
        .overlay(alignment: .bottom) {
            Divider().overlay(RalphyTheme.divider)
        }
    }
}

private struct OverviewPlaceholder: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 12))
            .foregroundStyle(RalphyTheme.secondaryText)
            .padding(.horizontal, RalphyTheme.Spacing.xLarge)
            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
    }
}
