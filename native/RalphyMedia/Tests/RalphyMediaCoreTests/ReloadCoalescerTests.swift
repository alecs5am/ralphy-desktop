import Foundation
import Testing
@testable import RalphyMediaCore

@Test func reloadBurstRunsOneActiveAndOneFollowUp() async {
    let recorder = Recorder()
    let gate = ReloadCoalescer(delay: .milliseconds(10)) {
        await recorder.record()
        try? await Task.sleep(for: .milliseconds(30))
    }

    await gate.request()
    await gate.request()
    await gate.request()
    try? await Task.sleep(for: .milliseconds(100))

    #expect(await recorder.count == 2)
}

private actor Recorder {
    private(set) var count = 0

    func record() {
        count += 1
    }
}
