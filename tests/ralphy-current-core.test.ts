import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { RalphyBridgeClient } from "../electron/ralphy/client";

const currentCoreCapabilities = [
  "activity.list", "activity.subscribe", "activity.unsubscribe", "agent.auth.login",
  "agent.auth.status", "agent.credential.clear", "agent.credential.set",
  "agent.credential.status", "agent.providers", "agent.turn.resume", "agent.turn.start",
  "agent.turn.status", "agent.turn.stop", "calendar.list", "calendar.update",
  "campaign.list", "campaign.show", "campaign.update", "composition.build",
  "composition.list", "composition.revise", "composition.revision.show",
  "composition.revisions", "composition.select", "composition.show",
  "consumer.authenticate", "consumer.session.end", "consumer.session.start",
  "document.bind", "document.content", "document.create", "document.list",
  "document.revise", "document.revisions", "document.search", "document.show",
  "evaluation.create", "evaluation.list", "evaluation.show", "feedback.add",
  "feedback.list", "feedback.resolve", "locator.resolve", "media.list", "media.review",
  "media.revisions", "media.select", "media.show", "metric.list", "metric.totals",
  "migration.desktop.import", "migration.secret.import", "operation.find", "project.iteration.create",
  "project.iteration.list", "project.list", "project.overview", "project.show",
  "project.status", "project.update", "publication.cancel", "publication.list",
  "publication.lookup", "publication.publish", "publication.reconcile", "publication.recover",
  "publication.refresh", "run.cancel", "run.list", "run.objects", "run.results", "run.show",
  "session.end", "session.list", "session.show", "session.start", "system.hello", "unit.list",
  "unit.preview", "unit.revise", "unit.revision.show", "unit.revisions", "unit.select",
  "unit.show", "workspace.account.list", "workspace.account.upsert", "workspace.export",
  "workspace.import", "workspace.list", "workspace.overview", "workspace.show", "workspace.update",
] as const;

let fixtureDirectory: string;
let fixtureBin: string;

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), "ralphy-current-core-"));
  fixtureBin = join(fixtureDirectory, "ralphy-current-core-fixture");
  await writeFile(fixtureBin, `#!/usr/bin/env node
const readline = require("node:readline");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
readline.createInterface({ input: process.stdin }).once("line", (line) => {
  const request = JSON.parse(line);
  send({ v: 1, id: request.id, ok: true, result: {
    protocolVersion: 1,
    coreVersion: "1",
    schemaVersion: 9,
    storeId: "store-current",
    rootId: "${"a".repeat(64)}",
    capabilities: ${JSON.stringify(currentCoreCapabilities)},
    activitySequence: 6,
    startup: { state: "ready", migration: "complete" },
    limits: {
      maxFrameBytes: 1048576,
      maxRequestIdBytes: 128,
      maxInFlight: 64,
      maxSeenIds: 65536,
      maxOutboundBytes: 8388608,
      maxAgentDeltaBytes: 65536
    }
  }});
});
`);
  await chmod(fixtureBin, 0o755);
});

afterAll(async () => {
  await rm(fixtureDirectory, { recursive: true, force: true });
});

describe("current Core bridge contract", () => {
  test("accepts the exact current system.hello shape and capabilities", async () => {
    const client = new RalphyBridgeClient({ bin: fixtureBin, root: "/fixture-root" });
    await expect(client.start()).resolves.toEqual({
      protocolVersion: 1,
      coreVersion: "1",
      schemaVersion: 9,
      storeId: "store-current",
      rootId: "a".repeat(64),
      capabilities: [...currentCoreCapabilities],
      activitySequence: 6,
      startup: { state: "ready", migration: "complete" },
      limits: {
        maxFrameBytes: 1048576,
        maxRequestIdBytes: 128,
        maxInFlight: 64,
        maxSeenIds: 65536,
        maxOutboundBytes: 8388608,
        maxAgentDeltaBytes: 65536,
      },
    });
    await client.close();
  });

  const exactCoreBin = process.env.RALPHY_CORE_BIN;
  const exactCoreRoot = process.env.RALPHY_CORE_TEST_ROOT;
  (exactCoreBin && exactCoreRoot ? test : test.skip)(
    "handshakes with the explicit locally built Core binary",
    async () => {
      const client = new RalphyBridgeClient({
        bin: exactCoreBin!,
        root: exactCoreRoot!,
      });
      const hello = await client.start();
      expect(hello.capabilities).toEqual([...currentCoreCapabilities]);
      await client.close();
    },
  );
});
