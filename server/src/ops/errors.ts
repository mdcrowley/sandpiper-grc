/**
 * A refusal or failure to report to the operator as a plain message. `exitCode` 1 means
 * nothing was changed; 2 means the data folder was being replaced when it failed.
 */
export class OpsError extends Error {
  exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}
