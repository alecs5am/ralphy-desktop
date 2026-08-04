export interface RootIdentity {
  storeId: string;
  label: string;
}

interface RootHello {
  storeId: string;
  activitySequence: number;
}

interface RootSessionLike {
  root: string | null;
  hello: RootHello | null;
  client: unknown;
  open(root: string, hooks: {
    beforePreviousClose(): Promise<void>;
    afterPreviousClose(): void;
  }): Promise<RootHello>;
}

export async function openRootSession(options: {
  session: RootSessionLike;
  root: string;
  label: string;
  prepare?(): void | Promise<void>;
  invalidateFileTokens(): void;
  stopAgentTurns(): void;
  terminateTerminals(root: string): void;
  subscribeActivity(client: unknown, afterSequence: number): void | Promise<void>;
}): Promise<RootIdentity> {
  const previousRoot = options.session.root;
  const hello = await options.session.open(options.root, {
    async beforePreviousClose() {
      await options.prepare?.();
      if (previousRoot) {
        options.invalidateFileTokens();
        options.stopAgentTurns();
      }
    },
    afterPreviousClose() {
      if (previousRoot) options.terminateTerminals(previousRoot);
    },
  });
  await options.subscribeActivity(options.session.client, hello.activitySequence);
  return { storeId: hello.storeId, label: options.label };
}
