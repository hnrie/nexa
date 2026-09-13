import { useVoiceLocal } from "./voiceLocal";

describe("mute and deafen", () => {
  beforeEach(() => useVoiceLocal.setState({ muted: false, deafened: false }));

  it("unmuting while deafened undeafens as well", () => {
    useVoiceLocal.getState().toggleDeafen();
    expect(useVoiceLocal.getState()).toMatchObject({ muted: true, deafened: true });
    useVoiceLocal.getState().toggleMute();
    expect(useVoiceLocal.getState()).toMatchObject({ muted: false, deafened: false });
  });

  it("muting leaves deafen alone", () => {
    useVoiceLocal.getState().toggleMute();
    expect(useVoiceLocal.getState()).toMatchObject({ muted: true, deafened: false });
    useVoiceLocal.getState().toggleMute();
    expect(useVoiceLocal.getState()).toMatchObject({ muted: false, deafened: false });
  });

  it("undeafening unmutes", () => {
    useVoiceLocal.getState().toggleDeafen();
    useVoiceLocal.getState().toggleDeafen();
    expect(useVoiceLocal.getState()).toMatchObject({ muted: false, deafened: false });
  });
});
