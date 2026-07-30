import Foundation
import RalphyMediaCore
import SwiftUI

@main
struct RalphyMediaApp: App {
    @StateObject private var viewModel = LibraryViewModel()

    init() {
        if let flagIndex = CommandLine.arguments.firstIndex(of: "--scan-only"),
           CommandLine.arguments.indices.contains(flagIndex + 1) {
            let root = URL(filePath: CommandLine.arguments[flagIndex + 1])
            do {
                let result = try MediaScanner().scan(root: root)
                print("Indexed \(result.items.count) files in \(root.path)")
                Foundation.exit(0)
            } catch {
                fputs("Scan failed: \(error)\n", stderr)
                Foundation.exit(1)
            }
        }

        if CommandLine.arguments.count == 2, !CommandLine.arguments[1].hasPrefix("-") {
            AppSettings().lastRoot = URL(filePath: CommandLine.arguments[1])
        }
    }

    var body: some Scene {
        WindowGroup("Ralphy Media") {
            LibraryWindow(viewModel: viewModel)
                .frame(minWidth: 1100, minHeight: 720)
        }
        .windowStyle(.titleBar)
        .commands {
            LibraryCommands(viewModel: viewModel)
        }
    }
}

private struct LibraryCommands: Commands {
    @ObservedObject var viewModel: LibraryViewModel

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("Choose Library...") {
                viewModel.pickLibrary()
            }
            .keyboardShortcut("o", modifiers: .command)
        }

        CommandMenu("Review") {
            Button("Quick Look") {
                viewModel.showQuickLook()
            }
            .disabled(viewModel.selectedIDs.isEmpty)

            Button("Open Selection") {
                viewModel.openSelection()
            }
            .keyboardShortcut(.return, modifiers: .command)
            .disabled(viewModel.selectedIDs.isEmpty)

            Button("Reveal in Finder") {
                viewModel.revealSelectionInFinder()
            }
            .keyboardShortcut("r", modifiers: [.command, .option])
            .disabled(viewModel.selectedIDs.isEmpty)

            Divider()

            Button("Keep") {
                viewModel.setVerdict(.keep)
            }
            .keyboardShortcut("k", modifiers: [.command, .control])
            .disabled(viewModel.selectedIDs.isEmpty)

            Button("Maybe") {
                viewModel.setVerdict(.maybe)
            }
            .keyboardShortcut("m", modifiers: [.command, .control])
            .disabled(viewModel.selectedIDs.isEmpty)

            Button("Reject") {
                viewModel.setVerdict(.reject)
            }
            .keyboardShortcut("r", modifiers: [.command, .control])
            .disabled(viewModel.selectedIDs.isEmpty)

            Button("Unreviewed") {
                viewModel.setVerdict(.unreviewed)
            }
            .keyboardShortcut("u", modifiers: [.command, .control])
            .disabled(viewModel.selectedIDs.isEmpty)

            Menu("Rating") {
                ForEach(0...5, id: \.self) { rating in
                    Button(rating == 0 ? "Clear Rating" : "\(rating) Stars") {
                        viewModel.setRating(rating)
                    }
                    .keyboardShortcut(
                        KeyEquivalent(Character(String(rating))),
                        modifiers: [.command, .option]
                    )
                }
            }
            .disabled(viewModel.selectedIDs.isEmpty)

            Button("Toggle Favorite") {
                viewModel.toggleFavorite()
            }
            .keyboardShortcut("f", modifiers: [.command, .option])
            .disabled(viewModel.selectedIDs.isEmpty)

            Divider()

            Button("Select All Media") {
                viewModel.selectAllVisible()
            }
            .keyboardShortcut("a", modifiers: [.command, .shift])
            .disabled(viewModel.visibleItems.isEmpty)

            Button("Copy Paths") {
                viewModel.copyPaths()
            }
            .keyboardShortcut("c", modifiers: [.command, .option])
            .disabled(viewModel.selectedIDs.isEmpty)

            Button("Copy for Agent") {
                viewModel.copyForAgent()
            }
            .keyboardShortcut("c", modifiers: [.command, .option, .shift])
            .disabled(viewModel.selectedIDs.isEmpty)

            Divider()

            Button("Move to Trash", role: .destructive) {
                viewModel.requestTrash()
            }
            .keyboardShortcut(.delete, modifiers: .command)
            .disabled(viewModel.selectedIDs.isEmpty)
        }
    }
}
