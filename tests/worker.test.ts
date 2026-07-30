import { describe, expect, test } from "vitest";
import {
  NewestPendingRunner,
  ScanRequestCancelledError,
} from "../electron/media/worker";

describe("one-worker project scheduling", () => {
  test("cancels the active request, drops stale pending work, and runs only the newest request", async () => {
    const started: string[] = [];
    const runner = new NewestPendingRunner<string, string>(async (value, signal) => {
      started.push(value);
      if (value !== "first") return `done:${value}`;
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      throw new ScanRequestCancelledError();
    });

    const first = runner.submit("first");
    const stale = runner.submit("stale");
    const staleResult = stale.catch((error: unknown) => error);
    const newest = runner.submit("newest");

    await expect(first).rejects.toBeInstanceOf(ScanRequestCancelledError);
    await expect(staleResult).resolves.toBeInstanceOf(ScanRequestCancelledError);
    await expect(newest).resolves.toBe("done:newest");
    expect(started).toEqual(["first", "newest"]);
  });
});
