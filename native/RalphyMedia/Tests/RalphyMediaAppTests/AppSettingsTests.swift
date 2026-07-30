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
