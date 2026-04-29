import cliProgress from "cli-progress";
import ora, { type Ora } from "ora";

export type UiMode = "interactive" | "silent";

export interface Spinner {
  update(text: string): void;
  succeed(text?: string): void;
  fail(text?: string): void;
  stop(): void;
}

export interface Bar {
  tick(n?: number): void;
  setTotal(total: number): void;
  stop(): void;
}

export interface ProgressReporter {
  spinner(text: string): Spinner;
  bar(total: number, label: string): Bar;
  dispose(): void;
}

const NO_OP_SPINNER: Spinner = Object.freeze({
  update() {},
  succeed() {},
  fail() {},
  stop() {},
});

const NO_OP_BAR: Bar = Object.freeze({
  tick() {},
  setTotal() {},
  stop() {},
});

const SILENT_REPORTER: ProgressReporter = Object.freeze({
  spinner: () => NO_OP_SPINNER,
  bar: () => NO_OP_BAR,
  dispose() {},
});

interface ActiveHandle {
  stop(): void;
}

function createInteractiveReporter(): ProgressReporter {
  let active: ActiveHandle | null = null;

  const stopActive = () => {
    if (active) {
      const handle = active;
      active = null;
      handle.stop();
    }
  };

  const reporter: ProgressReporter = {
    spinner(text: string): Spinner {
      stopActive();
      const instance: Ora = ora({ text, stream: process.stderr, hideCursor: true }).start();
      const handle: ActiveHandle = { stop: () => instance.stop() };
      active = handle;
      const detach = () => {
        if (active === handle) active = null;
      };
      return {
        update(nextText: string) {
          instance.text = nextText;
        },
        succeed(nextText?: string) {
          instance.succeed(nextText);
          detach();
        },
        fail(nextText?: string) {
          instance.fail(nextText);
          detach();
        },
        stop() {
          instance.stop();
          detach();
        },
      };
    },
    bar(total: number, label: string): Bar {
      stopActive();
      const instance = new cliProgress.SingleBar(
        {
          stream: process.stderr,
          hideCursor: true,
          clearOnComplete: false,
          format: `${label} [{bar}] {percentage}% | {value}/{total} | elapsed {duration_formatted} | eta {eta_formatted}`,
          barCompleteChar: "█",
          barIncompleteChar: "░",
          etaBuffer: 50,
        },
        cliProgress.Presets.shades_classic,
      );
      instance.start(total, 0);
      const handle: ActiveHandle = { stop: () => instance.stop() };
      active = handle;
      const detach = () => {
        if (active === handle) active = null;
      };
      return {
        tick(n = 1) {
          instance.increment(n);
        },
        setTotal(nextTotal: number) {
          instance.setTotal(nextTotal);
        },
        stop() {
          instance.stop();
          detach();
        },
      };
    },
    dispose() {
      stopActive();
    },
  };

  return reporter;
}

export function createReporter(mode: UiMode): ProgressReporter {
  return mode === "interactive" ? createInteractiveReporter() : SILENT_REPORTER;
}
