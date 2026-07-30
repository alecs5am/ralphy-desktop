import Foundation

public struct WorkspaceSummary: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let description: String?
    public let projectCount: Int
    public let sharedAssetCount: Int
    public let unitCount: Int
    public let lastActivityAt: Date?
}

public struct ProjectSummary: Identifiable, Hashable, Sendable {
    public let id: ProjectReference
    public let name: String
    public let brief: String?
    public let status: String?
    public let phase: ProjectPhase
    public let lastActivityAt: Date?
    public let hasFinalRender: Bool
    public let unitCount: Int
    public let knownSpendUSD: Double?
}

public struct WorkspaceCatalogSnapshot: Sendable {
    public let workspaces: [WorkspaceSummary]
    public let projectsByWorkspace: [String: [ProjectSummary]]
    public let warnings: [String]

    public init(
        workspaces: [WorkspaceSummary],
        projectsByWorkspace: [String: [ProjectSummary]],
        warnings: [String]
    ) {
        self.workspaces = workspaces
        self.projectsByWorkspace = projectsByWorkspace
        self.warnings = warnings
    }

    public static let empty = WorkspaceCatalogSnapshot(
        workspaces: [],
        projectsByWorkspace: [:],
        warnings: []
    )

    public func projects(in workspaceID: String) -> [ProjectSummary] {
        projectsByWorkspace[workspaceID] ?? []
    }
}

public struct CatalogPathMetadata: Sendable {
    public let isDirectory: Bool
    public let modificationDate: Date?

    public init(isDirectory: Bool, modificationDate: Date?) {
        self.isDirectory = isDirectory
        self.modificationDate = modificationDate
    }
}

public struct CatalogFileSystem: Sendable {
    public var directoryChildren: @Sendable (URL) throws -> [URL]
    public var metadata: @Sendable (URL) throws -> CatalogPathMetadata?
    public var readData: @Sendable (URL, Int) throws -> Data

    public init(
        directoryChildren: @escaping @Sendable (URL) throws -> [URL],
        metadata: @escaping @Sendable (URL) throws -> CatalogPathMetadata?,
        readData: @escaping @Sendable (URL, Int) throws -> Data
    ) {
        self.directoryChildren = directoryChildren
        self.metadata = metadata
        self.readData = readData
    }

    public static let live = CatalogFileSystem(
        directoryChildren: { url in
            try FileManager.default.contentsOfDirectory(
                at: url,
                includingPropertiesForKeys: nil,
                options: [.skipsHiddenFiles]
            )
        },
        metadata: { url in
            guard FileManager.default.fileExists(atPath: url.path) else { return nil }
            let values = try url.resourceValues(forKeys: [.isDirectoryKey, .contentModificationDateKey])
            return CatalogPathMetadata(
                isDirectory: values.isDirectory == true,
                modificationDate: values.contentModificationDate
            )
        },
        readData: { url, maximumByteCount in
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            return try handle.read(upToCount: maximumByteCount) ?? Data()
        }
    )
}

public enum WorkspaceCatalogError: Error, Equatable {
    case notRalphyRoot
}

public struct WorkspaceCatalogScanner: Sendable {
    private let fileSystem: CatalogFileSystem

    public init(fileSystem: CatalogFileSystem = .live) {
        self.fileSystem = fileSystem
    }

    public func scan(root: URL) throws -> WorkspaceCatalogSnapshot {
        let root = root.standardizedFileURL
        let workspacesURL = root.appending(path: "workspaces")
        guard root.lastPathComponent == ".ralphy",
              try fileSystem.metadata(workspacesURL)?.isDirectory == true else {
            throw WorkspaceCatalogError.notRalphyRoot
        }

        var warnings: [String] = []
        let registry = readRegistry(at: root.appending(path: "registry.json"), warnings: &warnings)
        var workspaces: [WorkspaceSummary] = []
        var projectsByWorkspace: [String: [ProjectSummary]] = [:]

        for workspaceURL in directoryChildren(of: workspacesURL, warnings: &warnings) {
            guard let metadata = try? fileSystem.metadata(workspaceURL), metadata.isDirectory else { continue }
            let workspaceID = workspaceURL.lastPathComponent
            let workspaceMetadata = readWorkspace(at: workspaceURL.appending(path: "workspace.json"), warnings: &warnings)
            let projects = scanProjects(
                in: workspaceURL,
                workspaceID: workspaceID,
                registry: registry,
                warnings: &warnings
            )
            projectsByWorkspace[workspaceID] = projects

            let lastActivityAt = ([metadata.modificationDate] + projects.compactMap(\.lastActivityAt)).compactMap { $0 }.max()
            workspaces.append(WorkspaceSummary(
                id: workspaceID,
                name: workspaceMetadata?.name ?? workspaceID,
                description: workspaceMetadata?.description,
                projectCount: projects.count,
                sharedAssetCount: directChildCount(at: workspaceURL.appending(path: "shared"), warnings: &warnings),
                unitCount: directChildCount(at: workspaceURL.appending(path: "units"), warnings: &warnings),
                lastActivityAt: lastActivityAt
            ))
        }

        workspaces.sort(by: workspaceSort)
        return WorkspaceCatalogSnapshot(
            workspaces: workspaces,
            projectsByWorkspace: projectsByWorkspace,
            warnings: warnings
        )
    }

    private func scanProjects(
        in workspaceURL: URL,
        workspaceID: String,
        registry: [ProjectReference: RegistryProject],
        warnings: inout [String]
    ) -> [ProjectSummary] {
        let projectsURL = workspaceURL.appending(path: "projects")
        guard isDirectory(at: projectsURL) else { return [] }

        var projects: [ProjectSummary] = []
        for projectURL in directoryChildren(of: projectsURL, warnings: &warnings) {
            guard let metadata = try? fileSystem.metadata(projectURL), metadata.isDirectory else { continue }
            let projectID = projectURL.lastPathComponent
            let reference = ProjectReference(workspaceID: workspaceID, projectID: projectID)
            let record = registry[reference]
            let directChildren = directoryChildren(of: projectURL, warnings: &warnings)
            let childNames = Set(directChildren.map(\.lastPathComponent))
            let hasFinalRender = hasFinalRender(at: projectURL)
            let logDate = modificationDate(at: projectURL.appending(path: "logs/generations.jsonl"))
            let lastActivityAt = ([
                logDate,
                metadata.modificationDate,
                record?.updatedAt,
                record?.createdAt,
            ]).compactMap { $0 }.max()

            projects.append(ProjectSummary(
                id: reference,
                name: record?.name ?? projectID,
                brief: record?.brief,
                status: record?.status,
                phase: record?.phase ?? phase(forStatus: record?.status) ?? derivedPhase(
                    childNames: childNames,
                    hasFinalRender: hasFinalRender
                ),
                lastActivityAt: lastActivityAt,
                hasFinalRender: hasFinalRender,
                unitCount: childNames.contains("units") ? 1 : 0,
                knownSpendUSD: record?.knownSpendUSD
            ))
        }
        return projects.sorted(by: projectSort)
    }

    private func directChildCount(at url: URL, warnings: inout [String]) -> Int {
        guard isDirectory(at: url) else { return 0 }
        return directoryChildren(of: url, warnings: &warnings).count
    }

    private func hasFinalRender(at projectURL: URL) -> Bool {
        ["mp4", "mov", "m4v", "webm"].contains { extensionName in
            guard let metadata = try? fileSystem.metadata(
                projectURL.appending(path: "render/final.\(extensionName)")
            ) else { return false }
            return !metadata.isDirectory
        }
    }

    private func isDirectory(at url: URL) -> Bool {
        guard let metadata = try? fileSystem.metadata(url) else { return false }
        return metadata.isDirectory
    }

    private func modificationDate(at url: URL) -> Date? {
        guard let metadata = try? fileSystem.metadata(url) else { return nil }
        return metadata.modificationDate
    }

    private func directoryChildren(of url: URL, warnings: inout [String]) -> [URL] {
        do {
            return try fileSystem.directoryChildren(url)
        } catch {
            warnings.append("Could not read \(url.lastPathComponent).")
            return []
        }
    }

    private func readRegistry(at url: URL, warnings: inout [String]) -> [ProjectReference: RegistryProject] {
        guard let data = readData(at: url, warnings: &warnings) else { return [:] }
        do {
            let registry = try JSONDecoder.ralphy.decode(Registry.self, from: data)
            if registry.malformedProjectCount > 0 {
                warnings.append("Skipped \(registry.malformedProjectCount) malformed registry project entries.")
            }
            return registry.projects.reduce(into: [:]) { records, entry in
                let projectID = entry.value.id ?? entry.key
                guard let workspaceID = entry.value.workspace else { return }
                records[ProjectReference(workspaceID: workspaceID, projectID: projectID)] = entry.value
            }
        } catch {
            warnings.append("Could not read registry.json.")
            return [:]
        }
    }

    private func readWorkspace(at url: URL, warnings: inout [String]) -> WorkspaceMetadata? {
        guard let data = readData(at: url, warnings: &warnings) else { return nil }
        do {
            return try JSONDecoder.ralphy.decode(WorkspaceMetadata.self, from: data)
        } catch {
            warnings.append("Could not read workspace.json.")
            return nil
        }
    }

    private func readData(at url: URL, warnings: inout [String]) -> Data? {
        do {
            guard try fileSystem.metadata(url) != nil else { return nil }
            return try fileSystem.readData(url, 1_000_000)
        } catch {
            warnings.append("Could not read \(url.lastPathComponent).")
            return nil
        }
    }

    private func derivedPhase(childNames: Set<String>, hasFinalRender: Bool) -> ProjectPhase {
        if childNames.contains("POSTMORTEM.md") { return .postmortem }
        if childNames.contains("units") { return .unit }
        if childNames.contains("REPAIR.md") { return .repair }
        if childNames.contains("EVALUATION.md") { return .evaluation }
        if hasFinalRender || childNames.contains("render") { return .render }
        if childNames.contains("artifacts") { return .assets }
        if childNames.contains("prompts") || childNames.contains("PROMPTS.md") { return .prompts }
        if childNames.contains("SCENARIO.md") { return .scenario }
        if childNames.contains("PLAN.md") || childNames.contains("PRODUCTION_PLAN.md") { return .plan }
        if childNames.contains("STYLE.md") { return .style }
        if childNames.contains("BRIEF.md") { return .brief }
        return .unknown
    }

    private func phase(forStatus status: String?) -> ProjectPhase? {
        guard let status else { return nil }
        return switch status.lowercased() {
        case "rendering": .render
        case "completed": .complete
        case "planning": .plan
        default: ProjectPhase(rawValue: status.lowercased())
        }
    }

    private func projectSort(_ lhs: ProjectSummary, _ rhs: ProjectSummary) -> Bool {
        switch (lhs.lastActivityAt, rhs.lastActivityAt) {
        case let (left?, right?) where left != right: return left > right
        case (.some, .none): return true
        case (.none, .some): return false
        default:
            let comparison = lhs.name.localizedStandardCompare(rhs.name)
            return comparison == .orderedSame
                ? lhs.id.projectID.localizedStandardCompare(rhs.id.projectID) == .orderedAscending
                : comparison == .orderedAscending
        }
    }

    private func workspaceSort(_ lhs: WorkspaceSummary, _ rhs: WorkspaceSummary) -> Bool {
        switch (lhs.lastActivityAt, rhs.lastActivityAt) {
        case let (left?, right?) where left != right: return left > right
        case (.some, .none): return true
        case (.none, .some): return false
        default:
            let comparison = lhs.name.localizedStandardCompare(rhs.name)
            return comparison == .orderedSame
                ? lhs.id.localizedStandardCompare(rhs.id) == .orderedAscending
                : comparison == .orderedAscending
        }
    }
}

private struct Registry: Decodable {
    let projects: [String: RegistryProject]
    let malformedProjectCount: Int

    private enum CodingKeys: String, CodingKey {
        case projects
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard container.contains(.projects) else {
            projects = [:]
            malformedProjectCount = 0
            return
        }
        let projectContainer = try container.nestedContainer(keyedBy: RegistryProjectKey.self, forKey: .projects)
        var projects: [String: RegistryProject] = [:]
        var malformedProjectCount = 0
        for key in projectContainer.allKeys {
            do {
                projects[key.stringValue] = try projectContainer.decode(RegistryProject.self, forKey: key)
            } catch {
                malformedProjectCount += 1
            }
        }
        self.projects = projects
        self.malformedProjectCount = malformedProjectCount
    }
}

private struct RegistryProjectKey: CodingKey {
    let stringValue: String
    let intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        intValue = nil
    }

    init?(intValue: Int) {
        stringValue = String(intValue)
        self.intValue = intValue
    }
}

private struct RegistryProject: Decodable {
    let id: String?
    let name: String?
    let workspace: String?
    let brief: String?
    let status: String?
    let phase: ProjectPhase?
    let updatedAt: Date?
    let createdAt: Date?
    let knownSpendUSD: Double?

    enum CodingKeys: String, CodingKey {
        case id, name, workspace, brief, status, phase, updatedAt, createdAt, knownSpendUSD
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try? container.decode(String.self, forKey: .id)
        name = try? container.decode(String.self, forKey: .name)
        workspace = try? container.decode(String.self, forKey: .workspace)
        brief = try? container.decode(String.self, forKey: .brief)
        status = try? container.decode(String.self, forKey: .status)
        phase = try? container.decode(ProjectPhase.self, forKey: .phase)
        updatedAt = try? container.decode(Date.self, forKey: .updatedAt)
        createdAt = try? container.decode(Date.self, forKey: .createdAt)
        knownSpendUSD = try? container.decode(Double.self, forKey: .knownSpendUSD)
    }
}

private struct WorkspaceMetadata: Decodable {
    let name: String?
    let description: String?
}
