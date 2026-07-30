import Foundation
import Testing
@testable import RalphyMediaCore

@Test func feedbackMarkdownIncludesSelectedFileContextAndVerdicts() throws {
    let root = URL(filePath: "/tmp/example/.ralphy")
    let item = MediaItem(
        id: "workspaces/nightmaker/projects/hook/artifacts/videos/shot.mp4",
        url: root.appending(path: "workspaces/nightmaker/projects/hook/artifacts/videos/shot.mp4"),
        relativePath: "workspaces/nightmaker/projects/hook/artifacts/videos/shot.mp4",
        workspace: "nightmaker",
        project: "hook",
        bucket: .video,
        filename: "shot.mp4",
        fileExtension: "mp4",
        sizeBytes: 1200,
        createdAt: nil,
        modifiedAt: nil
    )
    let annotation = MediaAnnotation(
        rating: 2,
        favorite: false,
        verdict: .reject,
        tags: ["slop", "bad-motion"],
        note: "Hands melt during the courier shot.",
        updatedAt: Date(timeIntervalSince1970: 1)
    )

    let markdown = AgentFeedback.render(items: [item], annotations: [item.relativePath: annotation])

    #expect(markdown.contains("Copy for Agent"))
    #expect(markdown.contains("Selected: 1 file"))
    #expect(markdown.contains("### `\(item.relativePath)`"))
    #expect(markdown.contains("absolute path: `\(item.url.path)`"))
    #expect(markdown.contains("nightmaker / hook"))
    #expect(markdown.contains("workspaces/nightmaker/projects/hook/artifacts/videos/shot.mp4"))
    #expect(markdown.contains("rating: 2/5"))
    #expect(markdown.contains("verdict: reject"))
    #expect(markdown.contains("tags: slop, bad-motion"))
    #expect(markdown.contains("Hands melt during the courier shot."))
}

@Test func feedbackIncludesRalphyEntityAndGenerationCost() {
    let item = mediaItem(
        entity: .generatedAsset,
        generation: GenerationAttribution(
            costUSD: 0.15,
            provider: "google",
            model: "gemini-image",
            generatedAt: Date(timeIntervalSince1970: 10)
        )
    )
    let markdown = AgentFeedback.render(items: [item], annotations: [:])

    #expect(markdown.contains("- entity: generated asset"))
    #expect(markdown.contains("- generation cost: $0.15"))
    #expect(markdown.contains("- generation provider/model: google / gemini-image"))
    #expect(markdown.contains("- generated at: 1970-01-01T00:00:10Z"))
}

@Test func feedbackEscapesEmbeddedNewlinesInNotes() {
    let item = mediaItem()
    let annotation = MediaAnnotation(note: "First line\nSecond line")

    let markdown = AgentFeedback.render(items: [item], annotations: [item.relativePath: annotation])

    #expect(markdown.contains("- note: First line\\nSecond line"))
    #expect(!markdown.contains("- note: First line\nSecond line"))
}

private func mediaItem(
    entity: RalphyEntityKind = .finalRender,
    generation: GenerationAttribution? = nil
) -> MediaItem {
    MediaItem(
        id: "workspaces/nightmaker/projects/hook/artifacts/images/shot.png",
        url: URL(filePath: "/tmp/example/.ralphy/workspaces/nightmaker/projects/hook/artifacts/images/shot.png"),
        relativePath: "workspaces/nightmaker/projects/hook/artifacts/images/shot.png",
        workspace: "nightmaker",
        project: "hook",
        bucket: .image,
        filename: "shot.png",
        fileExtension: "png",
        sizeBytes: 1200,
        createdAt: nil,
        modifiedAt: nil,
        entity: entity,
        generation: generation
    )
}
