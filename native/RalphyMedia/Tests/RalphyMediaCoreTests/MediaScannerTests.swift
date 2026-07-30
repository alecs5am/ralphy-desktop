import Foundation
import Testing
@testable import RalphyMediaCore

@Test func scannerIndexesWorkspaceProjectMediaAndTextFiles() throws {
    let root = try TemporaryRalphy.make()
    try root.write("workspaces/nightmaker/projects/hook/artifacts/videos/shot.mp4", bytes: [0, 1, 2])
    try root.write("workspaces/nightmaker/projects/hook/artifacts/images/card.png", bytes: [0, 1])
    try root.write("workspaces/nightmaker/projects/hook/BRIEF.md", string: "Launch hook")
    try root.write("workspaces/nightmaker/projects/hook/artifacts/fonts/display.otf", bytes: [0])

    let result = try MediaScanner().scan(root: root.url)
    let items = result.items

    #expect(items.map(\.relativePath) == [
        "workspaces/nightmaker/projects/hook/BRIEF.md",
        "workspaces/nightmaker/projects/hook/artifacts/images/card.png",
        "workspaces/nightmaker/projects/hook/artifacts/videos/shot.mp4",
    ])
    #expect(items.first { $0.filename == "shot.mp4" }?.workspace == "nightmaker")
    #expect(items.first { $0.filename == "shot.mp4" }?.project == "hook")
    #expect(items.first { $0.filename == "shot.mp4" }?.bucket == .video)
    #expect(items.first { $0.filename == "card.png" }?.bucket == .image)
    #expect(items.first { $0.filename == "BRIEF.md" }?.bucket == .text)
    #expect(result.skipped == 0)
}

@Test func scannerIndexesOnlyTheRequestedProjectAndClassifiesEntities() throws {
    let root = try TemporaryRalphy.make()
    try root.write("workspaces/ws/projects/one/render/final.mp4", bytes: [1])
    try root.write("workspaces/ws/projects/one/artifacts/refs/logo.png", bytes: [1])
    try root.write("workspaces/ws/projects/one/artifacts/images/shot.png", bytes: [1])
    try root.write("workspaces/ws/projects/one/units/ad-01/video.mp4", bytes: [1])
    try root.write("workspaces/ws/projects/one/BRIEF.md", string: "# Brief")
    try root.write("workspaces/ws/projects/two/artifacts/images/other.png", bytes: [1])

    let result = try MediaScanner().scan(
        project: ProjectReference(workspaceID: "ws", projectID: "one"),
        root: root.url,
        attributions: [
            "artifacts/images/./shot.png": GenerationAttribution(
                costUSD: 0.15,
                provider: "provider",
                model: "model",
                generatedAt: nil
            ),
        ]
    )

    #expect(result.items.map(\.project) == Array(repeating: "one", count: 5))
    #expect(result.items.first { $0.filename == "final.mp4" }?.entity == .finalRender)
    #expect(result.items.first { $0.filename == "logo.png" }?.entity == .reference)
    #expect(result.items.first { $0.filename == "shot.png" }?.entity == .generatedAsset)
    #expect(result.items.first { $0.relativePath.contains("/units/") }?.entity == .unit)
    #expect(result.items.first { $0.filename == "BRIEF.md" }?.entity == .lifecycleDocument)
    #expect(result.items.first { $0.filename == "shot.png" }?.generation?.costUSD == 0.15)
}

@Test func scannerRejectsMissingAndEscapingProjects() throws {
    let root = try TemporaryRalphy.make()

    #expect(throws: MediaScannerError.self) {
        _ = try MediaScanner().scan(
            project: ProjectReference(workspaceID: "ws", projectID: "missing"),
            root: root.url
        )
    }
    #expect(throws: MediaScannerError.self) {
        _ = try MediaScanner().scan(
            project: ProjectReference(workspaceID: "ws", projectID: "../other"),
            root: root.url
        )
    }
}

@Test func scannerRejectsSymlinkedWorkspaceAncestor() throws {
    let root = try TemporaryRalphy.make()
    try root.write("workspaces/two/projects/one/render/final.mp4", bytes: [1])
    let workspaceLink = root.url.appending(path: "workspaces/ws")
    try FileManager.default.createSymbolicLink(
        at: workspaceLink,
        withDestinationURL: root.url.appending(path: "workspaces/two")
    )

    var result: ScanResult?
    do {
        result = try MediaScanner().scan(
            project: ProjectReference(workspaceID: "ws", projectID: "one"),
            root: root.url
        )
        Issue.record("Expected symlinked workspace ancestor to be rejected")
    } catch {
        #expect(error as? MediaScannerError == .projectNotFound)
    }
    #expect(result?.items.isEmpty ?? true)
}

@Test func scannerRejectsSymlinkedProjectsAncestor() throws {
    let root = try TemporaryRalphy.make()
    try root.write("workspaces/ws/placeholder.txt", bytes: [1])
    try root.write("workspaces/two/projects/one/render/final.mp4", bytes: [1])
    let projectsLink = root.url.appending(path: "workspaces/ws/projects")
    try FileManager.default.createSymbolicLink(
        at: projectsLink,
        withDestinationURL: root.url.appending(path: "workspaces/two/projects")
    )

    var result: ScanResult?
    do {
        result = try MediaScanner().scan(
            project: ProjectReference(workspaceID: "ws", projectID: "one"),
            root: root.url
        )
        Issue.record("Expected symlinked projects ancestor to be rejected")
    } catch {
        #expect(error as? MediaScannerError == .projectNotFound)
    }
    #expect(result?.items.isEmpty ?? true)
}

@Test func scannerSkipsInternalRenderWorkByDefault() throws {
    let root = try TemporaryRalphy.make()
    try root.write("workspaces/ws/projects/p/render/work-123/frame.jpg", bytes: [1])
    try root.write("workspaces/ws/projects/p/render/final.mp4", bytes: [1])

    let result = try MediaScanner().scan(root: root.url)

    #expect(result.items.map(\.filename) == ["final.mp4"])
}

@Test func scannerCanIncludeInternalRenderWork() throws {
    let root = try TemporaryRalphy.make()
    try root.write("workspaces/ws/projects/p/render/work-123/frame.jpg", bytes: [1])

    let result = try MediaScanner().scan(
        root: root.url,
        options: ScanOptions(includeIntermediates: true)
    )

    #expect(result.items.map(\.filename) == ["frame.jpg"])
}

@Test func scannerPrunesDependencyAndBuildDirectories() throws {
    let root = try TemporaryRalphy.make()
    for directory in ["node_modules", ".build", ".git", "__pycache__", ".venv", "venv"] {
        try root.write("workspaces/ws/projects/p/\(directory)/hidden.jpg", bytes: [1])
    }
    try root.write("workspaces/ws/projects/p/build/visible.jpg", bytes: [1])
    try root.write("workspaces/ws/projects/p/dist/visible.mp4", bytes: [1])

    let result = try MediaScanner().scan(root: root.url)

    #expect(result.items.map(\.relativePath) == [
        "workspaces/ws/projects/p/build/visible.jpg",
        "workspaces/ws/projects/p/dist/visible.mp4",
    ])
}

@Test func scannerRecognizesExpandedFileTypesCaseInsensitively() throws {
    let root = try TemporaryRalphy.make()
    let fixtures = [
        "image.BMP", "image.AVIF", "image.SVG", "sound.OGG",
        "notes.MARKDOWN", "page.HTM", "module.MJS", "common.CJS",
        "config.YAML", "config.YML", "config.TOML", "document.XML",
        "table.CSV", "table.TSV", "run.LOG", "script.PY", "script.SH",
        "script.ZSH", "guide.PDF",
    ]
    for filename in fixtures {
        try root.write("workspaces/ws/projects/p/artifacts/\(filename)", bytes: [1])
    }

    let result = try MediaScanner().scan(root: root.url)

    #expect(result.items.map { "\($0.filename)|\($0.bucket.rawValue)|\($0.fileExtension)" } == [
        "common.CJS|text|cjs", "config.TOML|text|toml",
        "config.YAML|text|yaml", "config.YML|text|yml",
        "document.XML|text|xml", "guide.PDF|document|pdf",
        "image.AVIF|image|avif", "image.BMP|image|bmp",
        "image.SVG|image|svg", "module.MJS|text|mjs",
        "notes.MARKDOWN|text|markdown", "page.HTM|text|htm",
        "run.LOG|text|log", "script.PY|text|py", "script.SH|text|sh",
        "script.ZSH|text|zsh", "sound.OGG|audio|ogg",
        "table.CSV|text|csv", "table.TSV|text|tsv",
    ])
}

@Test func scannerRejectsNonRalphyRoot() throws {
    let folder = URL(filePath: NSTemporaryDirectory()).appending(path: UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

    #expect(throws: MediaScannerError.notRalphyRoot) {
        _ = try MediaScanner().scan(root: folder)
    }
}
