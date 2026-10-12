import { Theme } from "@earendil-works/pi-coding-agent";
import { isFailedResult, type SingleResult } from "./result.ts";
import { EXIT_CODE } from "./types.ts";

export function createUi(theme: Theme) {
  const icons = {
    success: () => theme.fg("success", "✓"),
    error: () => theme.fg("error", "✗"),
    waiting: () => theme.fg("warning", "⏳"),
    partialFail: () => theme.fg("warning", "◐"),
    singleResultToIcon: (r: SingleResult) =>
      r.exitCode === EXIT_CODE.RUNNING
        ? icons.waiting()
        : isFailedResult(r)
          ? icons.error()
          : icons.success(),
  };

  return {
    icons,
  };
}
