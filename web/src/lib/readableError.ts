/**
 * An error whose message was written for the person reading it: a rule a
 * passcode breaks, a save that did not reach the account. `describeError`
 * shows any other Error's message only to the console, because a platform's
 * messages are written for developers; these it shows as they are.
 */
export class ReadableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadableError";
  }
}
