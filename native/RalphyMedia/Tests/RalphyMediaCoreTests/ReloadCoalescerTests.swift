import Foundation
import Testing
@testable import RalphyMediaCore

@Test func reloadBurstRunsOneActiveAndOneFollowUpWithoutOverlap() async {
    let probe = ActionProbe()
    let gate = ReloadCoalescer(delay: .zero) {
        await probe.run()
    }

    await gate.request()
    await probe.waitForStarted(1)
    await gate.request()
    await gate.request()
    await probe.allowOverlapCheck()
    await probe.waitForOverlapCheck()
    await probe.releaseNext()
    await probe.waitForStarted(2)
    await probe.releaseNext()
    await probe.waitForCompleted(2)

    let snapshot = await probe.snapshot
    #expect(snapshot.started == 2)
    #expect(snapshot.maxActive == 1)
}

private actor ActionProbe {
    private var started = 0
    private var completed = 0
    private var active = 0
    private var maxActive = 0
    private var releases: [CheckedContinuation<Void, Never>] = []
    private var overlapCheckAllowed = false
    private var overlapCheckCompleted = false
    private var overlapCheckGate: CheckedContinuation<Void, Never>?
    private var overlapCheckWaiters: [CheckedContinuation<Void, Never>] = []
    private var startedWaiters: [(Int, CheckedContinuation<Void, Never>)] = []
    private var completedWaiters: [(Int, CheckedContinuation<Void, Never>)] = []

    var snapshot: (started: Int, maxActive: Int) {
        (started, maxActive)
    }

    func run() async {
        started += 1
        active += 1
        maxActive = max(maxActive, active)
        resumeSatisfied(&startedWaiters, value: started)
        if started == 1 {
            if !overlapCheckAllowed {
                await withCheckedContinuation { overlapCheckGate = $0 }
            }
            for _ in 0..<10 {
                await Task.yield()
            }
            overlapCheckCompleted = true
            overlapCheckWaiters.forEach { $0.resume() }
            overlapCheckWaiters.removeAll()
        }
        await withCheckedContinuation { releases.append($0) }
        active -= 1
        completed += 1
        resumeSatisfied(&completedWaiters, value: completed)
    }

    func waitForStarted(_ count: Int) async {
        guard started < count else { return }
        await withCheckedContinuation { startedWaiters.append((count, $0)) }
    }

    func waitForCompleted(_ count: Int) async {
        guard completed < count else { return }
        await withCheckedContinuation { completedWaiters.append((count, $0)) }
    }

    func allowOverlapCheck() {
        overlapCheckAllowed = true
        overlapCheckGate?.resume()
        overlapCheckGate = nil
    }

    func waitForOverlapCheck() async {
        guard !overlapCheckCompleted else { return }
        await withCheckedContinuation { overlapCheckWaiters.append($0) }
    }

    func releaseNext() {
        releases.removeFirst().resume()
    }

    private func resumeSatisfied(
        _ waiters: inout [(Int, CheckedContinuation<Void, Never>)],
        value: Int
    ) {
        let ready = waiters.filter { $0.0 <= value }
        waiters.removeAll { $0.0 <= value }
        ready.forEach { $0.1.resume() }
    }
}
