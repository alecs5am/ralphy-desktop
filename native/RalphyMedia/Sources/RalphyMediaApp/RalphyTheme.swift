import AppKit
import Foundation
import RalphyMediaCore
import SwiftUI

enum RalphyTheme {
    static let canvas = adaptiveColor(
        dark: NSColor(srgbRed: 0.075, green: 0.075, blue: 0.075, alpha: 1),
        light: NSColor(srgbRed: 0.965, green: 0.955, blue: 0.945, alpha: 1)
    )
    static let sidebar = adaptiveColor(
        dark: NSColor(srgbRed: 0.105, green: 0.105, blue: 0.105, alpha: 1),
        light: NSColor(srgbRed: 0.925, green: 0.91, blue: 0.895, alpha: 1)
    )
    static let raised = adaptiveColor(
        dark: NSColor(srgbRed: 0.14, green: 0.14, blue: 0.14, alpha: 1),
        light: .white
    )
    static let selectedRow = adaptiveColor(
        dark: NSColor(srgbRed: 0.205, green: 0.195, blue: 0.195, alpha: 1),
        light: NSColor(srgbRed: 0.855, green: 0.835, blue: 0.825, alpha: 1)
    )
    static let primaryText = adaptiveColor(
        dark: NSColor(srgbRed: 0.94, green: 0.925, blue: 0.9, alpha: 1),
        light: NSColor(srgbRed: 0.12, green: 0.105, blue: 0.1, alpha: 1)
    )
    static let secondaryText = adaptiveColor(
        dark: NSColor(srgbRed: 0.64, green: 0.62, blue: 0.6, alpha: 1),
        light: NSColor(srgbRed: 0.38, green: 0.36, blue: 0.35, alpha: 1)
    )
    static let divider = adaptiveColor(
        dark: NSColor(white: 1, alpha: 0.09),
        light: NSColor(white: 0, alpha: 0.12)
    )
    static let focus = adaptiveColor(
        dark: NSColor(srgbRed: 0.72, green: 0.43, blue: 0.48, alpha: 1),
        light: NSColor(srgbRed: 0.58, green: 0.27, blue: 0.34, alpha: 1)
    )
    static let amber = adaptiveColor(
        dark: NSColor(srgbRed: 0.83, green: 0.59, blue: 0.27, alpha: 1),
        light: NSColor(srgbRed: 0.61, green: 0.38, blue: 0.08, alpha: 1)
    )
    static let approved = adaptiveColor(
        dark: NSColor(srgbRed: 0.37, green: 0.65, blue: 0.43, alpha: 1),
        light: NSColor(srgbRed: 0.16, green: 0.46, blue: 0.24, alpha: 1)
    )
    static let rejected = adaptiveColor(
        dark: NSColor(srgbRed: 0.78, green: 0.38, blue: 0.38, alpha: 1),
        light: NSColor(srgbRed: 0.64, green: 0.2, blue: 0.2, alpha: 1)
    )

    enum Spacing {
        static let xSmall: CGFloat = 4
        static let small: CGFloat = 6
        static let medium: CGFloat = 8
        static let large: CGFloat = 12
        static let xLarge: CGFloat = 16
    }

    enum Radius {
        static let small: CGFloat = 4
        static let medium: CGFloat = 6
        static let maximum: CGFloat = 8
    }

    private static func adaptiveColor(dark: NSColor, light: NSColor) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
        })
    }
}

enum WorkspaceSortOption: String, CaseIterable, Sendable {
    case recent
    case name
    case projectCount

    var label: String {
        switch self {
        case .recent: "Recent"
        case .name: "Name"
        case .projectCount: "Project count"
        }
    }
}

enum ProjectSortOption: String, CaseIterable, Sendable {
    case recent
    case name
    case phase

    var label: String {
        switch self {
        case .recent: "Recent"
        case .name: "Name"
        case .phase: "Phase"
        }
    }
}

protocol WorkspacePresentable {
    var id: String { get }
    var name: String { get }
    var projectCount: Int { get }
    var lastActivityAt: Date? { get }
}

protocol ProjectPresentable {
    var id: ProjectReference { get }
    var name: String { get }
    var phase: ProjectPhase { get }
    var lastActivityAt: Date? { get }
}

extension WorkspaceSummary: WorkspacePresentable {}
extension ProjectSummary: ProjectPresentable {}

enum WorkspacePresentation {
    static func sorted<Value: WorkspacePresentable>(
        _ workspaces: [Value],
        by sort: WorkspaceSortOption,
        pinned: Set<String>
    ) -> [Value] {
        workspaces.sorted { lhs, rhs in
            let lhsPinned = pinned.contains(lhs.id)
            let rhsPinned = pinned.contains(rhs.id)
            if lhsPinned != rhsPinned {
                return lhsPinned
            }

            switch sort {
            case .recent:
                if lhs.lastActivityAt != rhs.lastActivityAt {
                    return (lhs.lastActivityAt ?? .distantPast)
                        > (rhs.lastActivityAt ?? .distantPast)
                }
            case .name:
                break
            case .projectCount:
                if lhs.projectCount != rhs.projectCount {
                    return lhs.projectCount > rhs.projectCount
                }
            }
            return namesThenIDs(
                lhsName: lhs.name,
                lhsID: lhs.id,
                rhsName: rhs.name,
                rhsID: rhs.id
            )
        }
    }

    static func activityDescription(_ date: Date?, now: Date = Date()) -> String {
        guard let date else { return "No activity" }
        let interval = max(0, now.timeIntervalSince(date))
        if interval < 60 {
            return "Just now"
        }
        if interval < 3_600 {
            return "\(Int(interval / 60))m ago"
        }
        if interval < 86_400 {
            return "\(Int(interval / 3_600))h ago"
        }
        if interval < 604_800 {
            return "\(Int(interval / 86_400))d ago"
        }
        return date.formatted(date: .abbreviated, time: .omitted)
    }
}

enum ProjectPresentation {
    static func sorted<Value: ProjectPresentable>(
        _ projects: [Value],
        by sort: ProjectSortOption,
        pinned: Set<ProjectReference>
    ) -> [Value] {
        projects.sorted { lhs, rhs in
            let lhsPinned = pinned.contains(lhs.id)
            let rhsPinned = pinned.contains(rhs.id)
            if lhsPinned != rhsPinned {
                return lhsPinned
            }

            switch sort {
            case .recent:
                if lhs.lastActivityAt != rhs.lastActivityAt {
                    return (lhs.lastActivityAt ?? .distantPast)
                        > (rhs.lastActivityAt ?? .distantPast)
                }
            case .name:
                break
            case .phase:
                let lhsOrder = phaseOrder(lhs.phase)
                let rhsOrder = phaseOrder(rhs.phase)
                if lhsOrder != rhsOrder {
                    return lhsOrder < rhsOrder
                }
            }
            return namesThenIDs(
                lhsName: lhs.name,
                lhsID: lhs.id.projectID,
                rhsName: rhs.name,
                rhsID: rhs.id.projectID
            )
        }
    }

    static func phaseLabel(_ phase: ProjectPhase) -> String {
        switch phase {
        case .brief: "Brief"
        case .style: "Style"
        case .plan: "Plan"
        case .scenario: "Scenario"
        case .prompts: "Prompts"
        case .assets: "Assets"
        case .render: "Render"
        case .evaluation: "Evaluation"
        case .repair: "Repair"
        case .unit: "Unit"
        case .postmortem: "Postmortem"
        case .complete: "Complete"
        case .unknown: "Unknown"
        }
    }

    static func spendLabel(_ spend: Double?) -> String {
        guard let spend else { return "Cost not indexed" }
        guard spend != 0 else { return "No charge" }
        return String(
            format: "$%.2f",
            locale: Locale(identifier: "en_US_POSIX"),
            spend
        )
    }

    static func mode(for entity: RalphyEntityKind) -> ProjectMode {
        switch entity {
        case .finalRender: .finals
        case .generatedAsset: .assets
        case .reference: .refs
        case .unit: .units
        case .lifecycleDocument, .productionFile: .files
        }
    }

    static func modeLabel(_ mode: ProjectMode) -> String {
        switch mode {
        case .overview: "Overview"
        case .finals: "Finals"
        case .assets: "Assets"
        case .refs: "Refs"
        case .units: "Units"
        case .files: "Files"
        }
    }

    static func entityLabel(_ entity: RalphyEntityKind) -> String {
        switch entity {
        case .finalRender: "Final"
        case .generatedAsset: "Asset"
        case .reference: "Reference"
        case .unit: "Unit"
        case .lifecycleDocument: "Lifecycle"
        case .productionFile: "File"
        }
    }

    static func entitySymbol(_ entity: RalphyEntityKind) -> String {
        switch entity {
        case .finalRender: "checkered.flag"
        case .generatedAsset: "sparkles.rectangle.stack"
        case .reference: "paperclip"
        case .unit: "shippingbox"
        case .lifecycleDocument: "list.bullet.clipboard"
        case .productionFile: "doc"
        }
    }

    static func filterSummary(
        mode: ProjectMode,
        bucket: MediaBucket?,
        verdict: ReviewVerdict?,
        sort: MediaSort,
        group: MediaGroup,
        includesIntermediates: Bool,
        gridSize: Double
    ) -> String {
        [
            modeLabel(mode),
            bucket.map(bucketLabel) ?? "All types",
            verdict?.displayName ?? "All review",
            mediaSortLabel(sort),
            groupLabel(group),
            includesIntermediates ? "Intermediates" : "Final outputs only",
            "Grid \(Int(gridSize.rounded()))",
        ].joined(separator: " · ")
    }

    static func bucketLabel(_ bucket: MediaBucket) -> String {
        switch bucket {
        case .image: "Image"
        case .video: "Video"
        case .audio: "Audio"
        case .text: "Text"
        case .document: "Document"
        case .other: "Other"
        }
    }

    static func mediaSortLabel(_ sort: MediaSort) -> String {
        switch sort {
        case .name: "Name"
        case .newest: "Newest"
        case .oldest: "Oldest"
        }
    }

    static func groupLabel(_ group: MediaGroup) -> String {
        switch group {
        case .none: "Ungrouped"
        case .workspace: "Workspace"
        case .project: "Project"
        case .type: "Type"
        case .entity: "Entity"
        case .folder: "Folder"
        }
    }

    private static func phaseOrder(_ phase: ProjectPhase) -> Int {
        ProjectPhase.allCases.firstIndex(of: phase) ?? ProjectPhase.allCases.count
    }
}

private func namesThenIDs(
    lhsName: String,
    lhsID: String,
    rhsName: String,
    rhsID: String
) -> Bool {
    let comparison = lhsName.localizedStandardCompare(rhsName)
    return comparison == .orderedSame
        ? lhsID.localizedStandardCompare(rhsID) == .orderedAscending
        : comparison == .orderedAscending
}
