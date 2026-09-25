import { describe, expect, it } from "vitest";
import { ApiError, errorFrom, genericMessage } from "@/api/client";
import { describeError } from "./errors";
import { ReadableError } from "./readableError";

describe("describeError", () => {
  it("never shows the status line for a response with no envelope", () => {
    const err = errorFrom(500, "<html>502 Bad Gateway</html>", null);
    expect(err.code).toBe("http_500");
    expect(err.message).not.toMatch(/Request failed with status/);
    // the caller's own sentence beats anything generic
    expect(describeError(err, "Could not create the channel.")).toBe("Could not create the channel.");
    // and with nothing to fall back on, it is still a sentence
    expect(describeError(err)).toBe(genericMessage(500));
    expect(genericMessage(500)).not.toMatch(/status/i);
  });

  it("keeps the server's own words when the server had some", () => {
    const err = new ApiError(403, "missing_permissions", "You cannot ban someone above you.");
    expect(describeError(err, "Could not ban them.")).toBe("You cannot ban someone above you.");
  });

  it("turns a browser exception into the thing that went wrong", () => {
    const denied = new DOMException("Permission denied", "NotAllowedError");
    expect(describeError(denied, "The microphone could not be opened.")).not.toMatch(/NotAllowedError/);
    expect(describeError(denied)).toBe(describeError(new DOMException("whatever", "NotAllowedError")));
    const busy = new DOMException("Device in use", "NotReadableError");
    expect(describeError(busy)).not.toBe(describeError(denied));
  });

  it("does not leak a message written for a developer", () => {
    const crypto = new Error("The operation failed for an operation-specific reason");
    expect(describeError(crypto, "That did not work.")).toBe("That did not work.");
    expect(describeError("a string", "That did not work.")).toBe("That did not work.");
  });

  it("says something different for 429, 4xx and 5xx", () => {
    const three = new Set([genericMessage(429), genericMessage(404), genericMessage(503)]);
    expect(three.size).toBe(3);
  });

  it("shows a sentence written for the reader as it is, and keeps a platform's own message to the console", () => {
    // a passcode rule used to come out as "Something went wrong"
    expect(describeError(new ReadableError("Use at least 6 digits, or mix in letters."), "Something went wrong.")).toBe("Use at least 6 digits, or mix in letters.");
    expect(describeError(new Error("InvalidStateError: the database connection is closing"), "Something went wrong.")).toBe("Something went wrong.");
  });

  it("refuses a short passcode in words", async () => {
    const { enableLock } = await import("./appLock");
    const err = await enableLock("u-readable", { publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) }, "1379").catch((e: unknown) => e);
    expect(describeError(err)).toMatch(/at least 6 digits/i);
  });
});
