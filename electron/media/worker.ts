import { isMainThread, parentPort } from "node:worker_threads";
import { buildShallowCatalog } from "./catalog";
import {
  ScanCancelledError,
  scanProject,
} from "./project-scanner";
import type {
  ProjectScanRequest,
  ProjectScanResult,
  WorkerRequest,
  WorkerResponse,
} from "./types";

interface PendingJob<Input, Output> {
  input: Input;
  resolve: (value: Output) => void;
  reject: (error: Error) => void;
}

export class ScanRequestCancelledError extends Error {
  constructor() {
    super("Project scan request cancelled");
    this.name = "ScanRequestCancelledError";
  }
}

export class NewestPendingRunner<Input, Output> {
  readonly #run: (input: Input, signal: AbortSignal) => Promise<Output>;
  #active: { controller: AbortController; job: PendingJob<Input, Output> } | null = null;
  #pending: PendingJob<Input, Output> | null = null;

  constructor(run: (input: Input, signal: AbortSignal) => Promise<Output>) {
    this.#run = run;
  }

  submit(input: Input): Promise<Output> {
    return new Promise<Output>((resolve, reject) => {
      const job = { input, resolve, reject };
      if (!this.#active) {
        this.#start(job);
        return;
      }
      this.#pending?.reject(new ScanRequestCancelledError());
      this.#pending = job;
      this.#active.controller.abort();
    });
  }

  cancel(): void {
    this.#pending?.reject(new ScanRequestCancelledError());
    this.#pending = null;
    this.#active?.controller.abort();
  }

  #start(job: PendingJob<Input, Output>): void {
    const controller = new AbortController();
    const active = { controller, job };
    this.#active = active;
    void this.#run(job.input, controller.signal)
      .then(job.resolve, (error: unknown) => {
        job.reject(
          error instanceof ScanRequestCancelledError || error instanceof ScanCancelledError
            ? new ScanRequestCancelledError()
            : error instanceof Error ? error : new Error(String(error)),
        );
      })
      .finally(() => {
        if (this.#active !== active) return;
        this.#active = null;
        const pending = this.#pending;
        this.#pending = null;
        if (pending) this.#start(pending);
      });
  }
}

interface RuntimeProjectRequest {
  requestId: number;
  request: ProjectScanRequest;
}

function post(message: WorkerResponse): void {
  parentPort?.postMessage(message);
}

function startWorkerRuntime(): void {
  const projectRunner = new NewestPendingRunner<RuntimeProjectRequest, ProjectScanResult>(
    ({ requestId, request }, signal) => scanProject(request, {
      signal,
      onProgress(progress) {
        post({ type: "project-progress", requestId, progress });
      },
    }),
  );

  parentPort?.on("message", (message: WorkerRequest) => {
    if (message.type === "cancel-project") {
      projectRunner.cancel();
      return;
    }
    if (message.type === "catalog") {
      void buildShallowCatalog(
        message.rootPath,
        message.generation,
        (progress) => post({
          type: "catalog-progress",
          requestId: message.requestId,
          progress,
        }),
      ).then(
        (result) => post({
          type: "catalog-result",
          requestId: message.requestId,
          result,
        }),
        (error: unknown) => post({
          type: "error",
          requestId: message.requestId,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      return;
    }

    void projectRunner.submit({
      requestId: message.requestId,
      request: message.request,
    }).then(
      (result) => post({
        type: "project-result",
        requestId: message.requestId,
        result,
      }),
      (error: unknown) => {
        if (error instanceof ScanRequestCancelledError) {
          post({ type: "project-cancelled", requestId: message.requestId });
        } else {
          post({
            type: "error",
            requestId: message.requestId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
  });
}

if (!isMainThread && parentPort) startWorkerRuntime();
