import Foundation

public enum AgentFeedback {
    public static func render(items: [MediaItem], annotations: [String: MediaAnnotation]) -> String {
        let count = items.count
        var lines = ["## Copy for Agent", "", "Selected: \(count) \(count == 1 ? "file" : "files")"]

        for item in items.sorted(by: { $0.relativePath < $1.relativePath }) {
            let annotation = annotations[item.relativePath] ?? MediaAnnotation()
            lines.append("")
            lines.append("### `\(item.relativePath)`")
            lines.append("- absolute path: `\(item.url.path)`")
            lines.append("- workspace/project: \(item.workspace) / \(item.project)")
            lines.append("- type: \(item.bucket.rawValue)")
            lines.append("- verdict: \(annotation.verdict.rawValue)")
            lines.append("- rating: \(annotation.rating)/5")
            lines.append("- favorite: \(annotation.favorite ? "yes" : "no")")
            if !annotation.tags.isEmpty {
                lines.append("- tags: \(annotation.tags.joined(separator: ", "))")
            }
            if !annotation.note.isEmpty {
                lines.append("- note: \(annotation.note)")
            }
        }

        return lines.joined(separator: "\n")
    }
}
