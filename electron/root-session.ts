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
    preparePreviousClose(previousRoot: string | null): Promise<void | RootPreparationRollback>;
    beforePreviousClose(previousRoot: string | null): void;
    afterPreviousClose(previousRoot: string | null): void;
  }): Promise<RootHello>;
}

export type RootPreparationRollback = () => void | Promise<void>;

export async function openRootSession(options: {
  session: RootSessionLike;
  root: string;
  label: string;
  prepare?(
    previousRoot: string | null,
  ): void | RootPreparationRollback | Promise<void | RootPreparationRollback>;
  invalidateFileTokens(): void;
  stopAgentTurns(): void;
  terminateTerminals(root: string): void;
  subscribeActivity(client: unknown, afterSequence: number): void | Promise<void>;
}): Promise<RootIdentity> {
  const hello = await options.session.open(options.root, {
    async preparePreviousClose(previousRoot) {
      return options.prepare?.(previousRoot);
    },
    beforePreviousClose(previousRoot) {
      if (previousRoot) {
        options.invalidateFileTokens();
        options.stopAgentTurns();
      }
    },
    afterPreviousClose(previousRoot) {
      if (previousRoot) options.terminateTerminals(previousRoot);
    },
  });
  await options.subscribeActivity(options.session.client, hello.activitySequence);
  return { storeId: hello.storeId, label: options.label };
}
