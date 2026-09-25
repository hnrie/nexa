import { randomBytes } from "@/crypto/bytes";
import { formatCallLength, openCallSummary, sealCallSummary, type CallSummary, type CallSummaryAad } from "./callSummary";

const aad: CallSummaryAad = { conv: "100", epoch: 3, channelId: "100", authorId: "7", messageId: "900" };
const summary: CallSummary = { outcome: "answered", duration: 754, joined: ["8"], declined: [] };

describe("call summaries", () => {
  it("opens what was sealed for the same line", async () => {
    const key = randomBytes(32);
    const env = await sealCallSummary(key, aad, summary);
    expect(env.conv).toBe("100");
    expect(env.epoch).toBe(3);
    expect(await openCallSummary(key, env, aad)).toEqual(summary);
  });

  it("will not open on another line, from another author, or as a message", async () => {
    const key = randomBytes(32);
    const env = await sealCallSummary(key, aad, summary);
    await expect(openCallSummary(key, env, { ...aad, messageId: "901" })).rejects.toThrow();
    await expect(openCallSummary(key, env, { ...aad, authorId: "8" })).rejects.toThrow();
    await expect(openCallSummary(randomBytes(32), env, aad)).rejects.toThrow();
  });

  it("refuses what is not a summary", async () => {
    const key = randomBytes(32);
    const bad = await sealCallSummary(key, aad, { ...summary, outcome: "won" as never });
    await expect(openCallSummary(key, bad, aad)).rejects.toThrow();
    const odd = await sealCallSummary(key, aad, { ...summary, joined: ["<b>"] });
    await expect(openCallSummary(key, odd, aad)).rejects.toThrow();
  });

  it("says how long in words", () => {
    expect(formatCallLength(45)).toBe("45 seconds");
    expect(formatCallLength(0)).toBe("1 second");
    expect(formatCallLength(12 * 60 + 10)).toBe("12 minutes");
    expect(formatCallLength(59 * 60 + 50)).toBe("1 hour");
    expect(formatCallLength(65 * 60)).toMatch(/^1 hour,? 5 minutes$/);
  });
});
