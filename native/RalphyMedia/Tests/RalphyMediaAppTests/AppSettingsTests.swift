import Foundation
import RalphyMediaCore
import Testing
@testable import RalphyMediaApp

@Test
func smartSourceSettingsRoundTripWithoutSearchText() throws {
    let suite = "app.ralphy.media.settings-tests.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    defaults.removePersistentDomain(forName: suite)
    let settings = AppSettings(defaults: defaults)

    settings.workspace = "workspace-a"
    settings.project = "project-b"
    settings.verdict = .maybe
    settings.favoriteOnly = true
    settings.excludeRejected = true

    let restored = AppSettings(defaults: defaults)
    #expect(restored.workspace == "workspace-a")
    #expect(restored.project == "project-b")
    #expect(restored.verdict == .maybe)
    #expect(restored.favoriteOnly)
    #expect(restored.excludeRejected)
    #expect(defaults.object(forKey: "mediaSearch") == nil)
}

@Test
func workspacePresentationSettingsRoundTripWithoutUsingLegacyActiveWorkspace() throws {
    let suite = "app.ralphy.media.workspace-settings-tests.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    defaults.removePersistentDomain(forName: suite)
    defaults.set("legacy-workspace", forKey: "activeWorkspace")

    let settings = AppSettings(defaults: defaults)
    #expect(settings.selectedWorkspaceID == nil)
    settings.selectedWorkspaceID = "workspace-a"
    settings.selectedProjectID = "project-b"
    settings.projectMode = .assets
    settings.workspaceSort = .newest
    settings.pinnedWorkspaceIDs = ["workspace-a", "workspace-c"]
    settings.pinnedProjectIDs = [
        ProjectReference(workspaceID: "workspace-a", projectID: "project-b"),
    ]
    settings.sidebarWidth = 320

    let restored = AppSettings(defaults: defaults)
    #expect(restored.selectedWorkspaceID == "workspace-a")
    #expect(restored.selectedProjectID == "project-b")
    #expect(restored.projectMode == .assets)
    #expect(restored.workspaceSort == .newest)
    #expect(restored.pinnedWorkspaceIDs == ["workspace-a", "workspace-c"])
    #expect(restored.pinnedProjectIDs == [
        ProjectReference(workspaceID: "workspace-a", projectID: "project-b"),
    ])
    #expect(restored.sidebarWidth == 320)
    #expect(defaults.string(forKey: "activeWorkspace") == "legacy-workspace")
}
