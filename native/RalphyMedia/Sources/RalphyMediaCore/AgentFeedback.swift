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
            lines.append("- entity: \(entityName(item.entity))")
            if let generation = item.generation {
                lines.append(String(format: "- generation cost: $%.2f", generation.costUSD))
                let providerAndModel = [generation.provider, generation.model].compactMap { $0 }.joined(separator: " / ")
                if !providerAndModel.isEmpty {
                    lines.append("- generation provider/model: \(providerAndModel)")
                }
                if let generatedAt = generation.generatedAt {
                    lines.append("- generated at: \(generatedAt.ISO8601Format())")
                }
            }
            lines.append("- verdict: \(annotation.verdict.rawValue)")
            lines.append("- rating: \(annotation.rating)/5")
            lines.append("- favorite: \(annotation.favorite ? "yes" : "no")")
            if !annotation.tags.isEmpty {
                lines.append("- tags: \(annotation.tags.joined(separator: ", "))")
            }
            if !annotation.note.isEmpty {
                lines.append("- note: \(escapedNewlines(annotation.note))")
            }
        }

        return lines.joined(separator: "\n")
    }

    private static func entityName(_ entity: RalphyEntityKind) -> String {
        switch entity {
        case .finalRender: "final render"
        case .generatedAsset: "generated asset"
        case .reference: "reference"
        case .unit: "unit"
        case .lifecycleDocument: "lifecycle document"
        case .productionFile: "production file"
        }
    }

    private static func escapedNewlines(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\r\n", with: "\\n")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\n")
    }
}
