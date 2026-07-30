import Foundation

public struct ProjectReference: Codable, Hashable, Sendable {
    public let workspaceID: String
    public let projectID: String

    public init(workspaceID: String, projectID: String) {
        self.workspaceID = workspaceID
        self.projectID = projectID
    }

    public var relativePath: String {
        "workspaces/\(workspaceID)/projects/\(projectID)"
    }
}

public enum RalphyEntityKind: String, Codable, CaseIterable, Hashable, Sendable {
    case finalRender
    case generatedAsset
    case reference
    case unit
    case lifecycleDocument
    case productionFile
}

public enum ProjectPhase: String, Codable, CaseIterable, Hashable, Sendable {
    case brief, style, plan, scenario, prompts, assets, render
    case evaluation, repair, unit, postmortem, complete, unknown
}

public struct GenerationAttribution: Codable, Hashable, Sendable {
    public let costUSD: Double
    public let provider: String?
    public let model: String?
    public let generatedAt: Date?

    public init(costUSD: Double, provider: String?, model: String?, generatedAt: Date?) {
        self.costUSD = costUSD
        self.provider = provider
        self.model = model
        self.generatedAt = generatedAt
    }
}
