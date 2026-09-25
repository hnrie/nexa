import type { Channel, Message, VoiceState } from "@/api/types";
import { voice as voiceApi } from "@/api/voice";
import { randomBytes } from "@/crypto/bytes";
import type { Envelope } from "@/crypto/message";
import { channelKeyFor, ring } from "@/lib/keyring";
import { useAuth } from "@/stores/auth";
import { useChannels } from "@/stores/channels";
import { useVoice } from "@/stores/voice";
import { callDeclined, callEnded, callLine, callStarted, callTimedOut, installCallRecord, resetCallRecords } from "./callRecord";
import { openCallSummary } from "./callSummary";

vi.mock("@/api/voice", () => ({ voice: { callSummary: vi.fn(async () => undefined) } }));

const DM = "500";

function state(user: string, channel: string | null, over: Partial<VoiceState> = {}): VoiceState {
  return { user_id: user, channel_id: channel, session_id: "s", self_mute: false, self_deaf: false, video: false, streaming: false, server_mute: false, server_deaf: false, joined_at: 1, ...over };
}

function line(): Message {
  return { id: "900", channel_id: DM, author_id: "1", type: "system_call", ciphertext: null, key_conv_id: null, key_epoch: null, reply_to_id: null, mentions: [], mention_roles: [], mention_everyone: false, attachments: [], reactions: [], flags: 0, edited_at: null, created_at: 0 };
}

/** What the caller's device wrote onto the line, opened again. */
async function written() {
  await vi.waitFor(() => expect(voiceApi.callSummary).toHaveBeenCalled());
  const [channelId, messageId, body] = vi.mocked(voiceApi.callSummary).mock.calls[0]!;
  expect(channelId).toBe(DM);
  expect(messageId).toBe("900");
  const env = body.ciphertext as Envelope;
  return openCallSummary(channelKeyFor(DM, body.key_epoch, DM)!, env, { conv: DM, epoch: body.key_epoch, channelId: DM, authorId: "1", messageId: "900" });
}

describe("what a call this device started came to", () => {
  beforeAll(() => installCallRecord());
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    vi.mocked(voiceApi.callSummary).mockClear();
    resetCallRecords();
    useAuth.setState({ me: { id: "1" } as never });
    useChannels.setState({ byId: { [DM]: { id: DM, type: "dm", recipient_ids: ["1", "2"], server_id: null } as unknown as Channel } });
    useVoice.getState().clear();
    ring.set(DM, 1, randomBytes(32));
  });
  afterEach(() => vi.useRealTimers());

  it("says how long people talked, from the answer to the last time two were in it", async () => {
    callStarted(DM);
    useVoice.getState().applyState(state("1", DM));
    vi.setSystemTime(1_010_000);
    useVoice.getState().applyState(state("2", DM));
    vi.setSystemTime(1_010_000 + 12 * 60_000);
    useVoice.getState().applyState(state("2", null, { old_channel_id: DM }));
    vi.setSystemTime(1_010_000 + 13 * 60_000);
    useVoice.getState().applyState(state("1", null, { old_channel_id: DM }));
    callLine(line());
    callEnded(DM);
    expect(await written()).toEqual({ outcome: "answered", duration: 12 * 60, joined: ["2"], declined: [] });
  });

  it("waits for its line when the call ends first", async () => {
    callStarted(DM);
    useVoice.getState().applyState(state("1", DM));
    callTimedOut(DM);
    useVoice.getState().applyState(state("1", null, { old_channel_id: DM }));
    callEnded(DM);
    expect(voiceApi.callSummary).not.toHaveBeenCalled();
    callLine(line());
    expect(await written()).toEqual({ outcome: "unanswered", duration: 0, joined: [], declined: [] });
  });

  it("tells a no from a hang-up", async () => {
    callStarted(DM);
    callLine(line());
    useVoice.getState().applyState(state("1", DM));
    callDeclined(DM, "2");
    useVoice.getState().applyState(state("1", null, { old_channel_id: DM }));
    callEnded(DM);
    expect((await written()).outcome).toBe("declined");
  });

  it("is a cancelled call when the caller hangs up before anything happened", async () => {
    callStarted(DM);
    callLine(line());
    useVoice.getState().applyState(state("1", DM));
    useVoice.getState().applyState(state("1", null, { old_channel_id: DM }));
    callEnded(DM);
    expect((await written()).outcome).toBe("cancelled");
  });

  it("does not count a guest waiting in the call as someone picking up", async () => {
    callStarted(DM);
    callLine(line());
    useVoice.getState().applyState(state("1", DM));
    useVoice.getState().applyState(state("g", DM, { guest: { epoch: 1 } }));
    useVoice.getState().applyState(state("1", null, { old_channel_id: DM }));
    useVoice.getState().applyState(state("g", null, { old_channel_id: DM }));
    callEnded(DM);
    expect((await written()).outcome).toBe("cancelled");
  });

  it("writes nothing for a call it did not start", async () => {
    callLine(line());
    callEnded(DM);
    await Promise.resolve();
    expect(voiceApi.callSummary).not.toHaveBeenCalled();
  });
});
