import AVKit
import Testing
@testable import RalphyMediaApp

@Test @MainActor
func nativePlayerViewUsesPublicViewAndOwnsPlayerLifecycle() {
    let firstPlayer = AVPlayer()
    let secondPlayer = AVPlayer()

    let view = NativePlayerView.makePlayerView(player: firstPlayer)

    #expect(type(of: view) == AVPlayerView.self)
    #expect(view.player === firstPlayer)

    NativePlayerView.updatePlayerView(view, player: secondPlayer)
    #expect(view.player === secondPlayer)

    NativePlayerView.dismantlePlayerView(view)
    #expect(view.player == nil)
}
