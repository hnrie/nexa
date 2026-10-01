import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/common/Button";
import { Select } from "@/components/common/Select";
import { Field } from "@/components/common/TextInput";
import { Toggle } from "@/components/common/Toggle";
import { describeError } from "@/lib/errors";
import { useSettings, type VoiceSettings } from "@/stores/settings";
import { useVoice } from "@/stores/voice";
import { LevelMeter, audioContext, defaultDeviceLabel, describeInput, getMic, holdAudio, lastInputChoice, listDevices, realDevices, sensitivityToThreshold, sentStream, type Devices } from "@/voice/media";
import { canChooseOutput } from "@/voice/output";
import { inVoice, noKeyToHold } from "@/voice/session";
import st from "./Settings.module.css";
import v from "@/components/voice/Voice.module.css";

import { t as tr_ } from "@/i18n";
/** User settings → Voice & Video. */
export default function VoicePage() {
  const settings = useSettings((s) => s.settings.voice);
  const patch = useSettings((s) => s.patch);
  const liveLevel = useVoice((x) => x.level);
  const [devices, setDevices] = useState<Devices | null>(null);
  const [testing, setTesting] = useState(false);
  const [testLevel, setTestLevel] = useState(0);
  const [sentLevel, setSentLevel] = useState(0);
  const [diag, setDiag] = useState("");
  // Kept apart from `diag`: that block is a device dump for someone reading it
  // closely, and a refused permission belongs in a sentence above it.
  const [micError, setMicError] = useState<string | null>(null);
  const [wrongDevice, setWrongDevice] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const captureRef = useRef<HTMLButtonElement>(null);
  // A touch screen has no key to hold, so calls there fall back to voice
  // activity (voice/session.ts); the page says so instead of promising a key.
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const aliveRef = useRef(true);
  const testRef = useRef<{ stream: MediaStream; meter: LevelMeter; timer: ReturnType<typeof setInterval>; sent?: MediaStream; sentMeter?: LevelMeter; gain?: GainNode | null; release: () => void } | null>(null);
  const set = (partial: Partial<VoiceSettings>) => patch({ voice: { ...settings, ...partial } });

  useEffect(() => {
    listDevices().then(setDevices).catch(() => setDevices({ inputs: [], outputs: [], cameras: [] }));
    const on = () => listDevices().then(setDevices).catch(() => {});
    navigator.mediaDevices?.addEventListener?.("devicechange", on);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", on);
  }, []);

  const stopTest = () => {
    const t = testRef.current;
    if (!t) return;
    clearInterval(t.timer);
    t.meter.close();
    t.sentMeter?.close();
    t.sent?.getTracks().forEach((x) => x.stop());
    t.stream.getTracks().forEach((x) => x.stop());
    t.release();
    testRef.current = null;
    setTesting(false);
    setTestLevel(0);
    setSentLevel(0);
    setWrongDevice(false);
  };
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      stopTest();
    };
  }, []);
  const startTest = async () => {
    // one test at a time, even while the permission prompt is still up
    if (startingRef.current || testRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setMicError(null);
    let stream: MediaStream | null = null;
    try {
      stream = await getMic(settings);
      const ctx = audioContext();
      if (ctx.state === "suspended") await ctx.resume();
      // Settings closed while the prompt was up: let the microphone go rather than holding it with nothing to show
      if (!aliveRef.current) {
        stream.getTracks().forEach((x) => x.stop());
        return;
      }
      const meter = new LevelMeter(ctx, stream);
      // The second meter listens to exactly what a call would send: the same
      // stream after the input slider. If this one stays flat while the first
      // moves, the trouble is here rather than with the microphone.
      const sent = sentStream(ctx, stream, settings.inputVolume);
      const sentMeter = new LevelMeter(ctx, sent.stream);
      const timer = setInterval(() => {
        setTestLevel(meter.level());
        setSentLevel(sentMeter.level());
      }, 60);
      testRef.current = { stream, meter, timer, sent: sent.stream, sentMeter, gain: sent.gain, release: holdAudio() };
      setTesting(true);
      setDiag(describeInput(ctx, stream, sent.stream, settings.inputVolume));
      setWrongDevice(lastInputChoice() === "missing");
      // permission granted: device labels are now readable
      listDevices().then(setDevices).catch(() => {});
    } catch (err) {
      if (stream && testRef.current?.stream !== stream) stream.getTracks().forEach((x) => x.stop());
      // The commonest failure here is the reader declining the browser's own
      // prompt, and `NotAllowedError: Permission denied` at 11px in a monospace
      // block is a stack trace, not an answer. `.diag` keeps the device dump
      // for the successful case; this says what happened in words.
      console.error("microphone test failed", err);
      setMicError(describeError(err, tr_("settings.voice.theMicrophoneCouldNotBeOpened2")));
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(false);
        return;
      }
      set({ pttKey: e.key.length === 1 ? e.key : e.code });
      setCapturing(false);
    };
    // a press anywhere else puts the box down, so it cannot be left waiting for a key forever
    const onDown = (e: PointerEvent) => {
      if (!captureRef.current?.contains(e.target as Node)) setCapturing(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  const level = testing ? testLevel : inVoice() ? liveLevel : 0;
  const threshold = settings.autoSensitivity ? null : sensitivityToThreshold(settings.sensitivity);
  // a browser keeps device names to itself until a device of the kind was allowed once
  const label = (d: MediaDeviceInfo, i: number, kind: "microphoneN" | "speakersN" | "cameraN") => d.label || tr_(`voice.devices.${kind}`, { n: i + 1 });
  // Safari plays calls on the system's output and cannot be told another
  const outputs = canChooseOutput();
  // a touch screen has no key to capture: push to talk there is a button in the call
  const holdButton = noKeyToHold();
  return (
    <>
      <h2 data-setting="devices" className={st.title}>{tr_("settings.voice.voiceVideo")}</h2>
      <div className={st.form}>
        <div className={`${st.twoCol} ${st.twoEqual}`}>
          <Field label={tr_("settings.voice.inputDevice")}>
            <Select
              value={settings.inputDeviceId ?? ""}
              data-testid="input-device"
              onChange={(e) => {
                const id = e.target.value || null;
                const chosen = devices?.inputs.find((d) => d.deviceId === id);
                set({ inputDeviceId: id, inputDeviceLabel: chosen?.label || null });
              }}
            >
              <option value="">{defaultDeviceLabel(devices?.inputs ?? [])}</option>
              {realDevices(devices?.inputs ?? []).map((d, i) => <option key={d.deviceId} value={d.deviceId}>{label(d, i, "microphoneN")}</option>)}
            </Select>
          </Field>
          <Field label={tr_("settings.voice.outputDevice")} hint={outputs ? undefined : tr_("settings.voice.thisBrowserPlaysCallsOnThe")}>
            <Select
              value={settings.outputDeviceId ?? ""}
              disabled={!outputs}
              onChange={(e) => {
                const id = e.target.value || null;
                const chosen = devices?.outputs.find((d) => d.deviceId === id);
                set({ outputDeviceId: id, outputDeviceLabel: chosen?.label || null });
              }}
            >
              <option value="">{defaultDeviceLabel(devices?.outputs ?? [])}</option>
              {realDevices(devices?.outputs ?? []).map((d, i) => <option key={d.deviceId} value={d.deviceId}>{label(d, i, "speakersN")}</option>)}
            </Select>
          </Field>
        </div>
        <div className={`${st.twoCol} ${st.twoEqual}`}>
          <Field label={tr_("settings.voice.inputVolumeValue", { percent: settings.inputVolume })}>
            <input type="range" className={st.slider} min={0} max={200} value={settings.inputVolume} onChange={(e) => set({ inputVolume: Number(e.target.value) })} />
          </Field>
          <Field label={tr_("settings.voice.outputVolumeValue", { percent: settings.outputVolume })}>
            <input type="range" className={st.slider} min={0} max={200} value={settings.outputVolume} onChange={(e) => set({ outputVolume: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label={tr_("settings.voice.micTest")} hint={tr_("settings.voice.speakAndWatchBothMetersThe")}>
          <div>
            <Button size="sm" variant={testing ? "danger" : "secondary"} onClick={() => (testing ? stopTest() : void startTest())} disabled={starting} data-testid="mic-test">{testing ? tr_("settings.voice.stopTest") : tr_("settings.voice.letSCheck")}</Button>
            <div className={v.meter} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)} aria-label={tr_("settings.voice.inputLevel")} data-testid="mic-level">
              <div className={v.meterFill} style={{ width: `${Math.round(level * 100)}%` }} />
              {threshold !== null ? <div className={v.meterMark} style={{ insetInlineStart: `${Math.round(threshold * 100)}%` }} /> : null}
            </div>
            {testing ? (
              <>
                <div className={v.meter} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(sentLevel * 100)} aria-label={tr_("settings.voice.levelOthersWouldHear")} data-testid="sent-level" style={{ marginTop: 6 }}>
                  <div className={v.meterFill} data-sent="true" style={{ width: `${Math.round(sentLevel * 100)}%` }} />
                </div>
                <p className={st.hint} style={{ marginTop: 6 }}>{tr_("settings.voice.topYourMicrophoneBottomWhatThe")}</p>
              </>
            ) : null}
            {wrongDevice ? (
              <div className={st.dangerBox} style={{ marginTop: 8 }} data-testid="wrong-device">
                {tr_("settings.voice.theMicrophoneYouPickedIsNot")}
              </div>
            ) : null}
            {micError ? <div className={st.dangerBox} style={{ marginTop: 8 }} role="alert" data-testid="mic-error">{micError}</div> : null}
            {diag ? <pre className={v.diag} data-testid="mic-diagnostics">{diag}</pre> : null}
          </div>
        </Field>
      </div>
      {/* Headings and radio cards sat in the form's 20px-gap column, so each
          heading floated 28px above what it named and the two cards stood
          28px apart; everywhere else they are 8px. */}
      <h3 data-setting="inputMode" className={st.h5}>{tr_("settings.voice.inputMode")}</h3>
      <div role="radiogroup" aria-label={tr_("settings.voice.inputMode")}>
        <label className={st.radio} data-on={settings.mode === "vad"}>
          <input type="radio" name="voice-input-mode" checked={settings.mode === "vad"} onChange={() => set({ mode: "vad" })} />
          <span className={st.radioText}><span className={st.radioLabel}>{tr_("settings.voice.voiceActivity")}</span><span className={st.radioDesc}>{tr_("settings.voice.transmitWheneverYouTalk")}</span></span>
        </label>
        <label className={st.radio} data-on={settings.mode === "ptt"}>
          <input type="radio" name="voice-input-mode" checked={settings.mode === "ptt"} onChange={() => set({ mode: "ptt" })} />
          <span className={st.radioText}><span className={st.radioLabel}>{tr_("settings.voice.pushToTalk")}</span><span className={st.radioDesc}>{holdButton ? tr_("settings.voice.transmitOnlyWhileYouHoldTheButton") : tr_("settings.voice.transmitOnlyWhileYouHoldA")}</span></span>
        </label>
      </div>
      <div className={st.form} style={{ marginTop: 12 }}>
        {settings.mode === "ptt" && holdButton ? (
          <p className={st.hint} data-testid="ptt-button-note">{tr_("settings.voice.onThisDevicePushToTalk")}</p>
        ) : settings.mode === "ptt" ? (
          <Field label={tr_("settings.voice.pushToTalkKey")} hint={tr_("settings.voice.clickTheBoxThenPressThe")}>
            <button ref={captureRef} type="button" className={v.keyCapture} data-capturing={capturing} onClick={() => setCapturing((c) => !c)} aria-pressed={capturing}>
              <span>{capturing ? tr_("settings.voice.pressAKey") : settings.pttKey}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{capturing ? tr_("settings.voice.escToCancel") : tr_("settings.security.change")}</span>
            </button>
          </Field>
        ) : (
          <>
            <Toggle checked={settings.autoSensitivity} onChange={(on) => set({ autoSensitivity: on })} label={tr_("settings.voice.automaticallyDetermineInputSensitivity")} description={tr_("settings.voice.learnsYourBackgroundNoiseAndOnly")} />
            {!settings.autoSensitivity ? (
              <Field label={tr_("settings.voice.inputSensitivityValue", { db: settings.sensitivity })}>
                <input type="range" className={st.slider} min={-100} max={0} value={settings.sensitivity} onChange={(e) => set({ sensitivity: Number(e.target.value) })} />
              </Field>
            ) : null}
          </>
        )}
      </div>
      <h3 data-setting="voiceProcessing" className={st.h5}>{tr_("settings.voice.voiceProcessing")}</h3>
      <Toggle checked={settings.noiseSuppression} onChange={(on) => set({ noiseSuppression: on })} label={tr_("settings.voice.noiseSuppression")} description={tr_("settings.voice.filtersKeyboardClatterAndFansWith")} />
      <Toggle checked={settings.echoCancellation} onChange={(on) => set({ echoCancellation: on })} label={tr_("settings.voice.echoCancellation")} />
      <Toggle checked={settings.autoGain} onChange={(on) => set({ autoGain: on })} label={tr_("settings.voice.automaticGainControl")} />
      <div className={st.form} style={{ marginTop: 24 }}>
        <Field label={tr_("settings.voice.camera")}>
          <Select
            value={settings.cameraDeviceId ?? ""}
            data-testid="camera-device"
            disabled={!devices?.cameras.length}
            onChange={(e) => {
              const id = e.target.value || null;
              const chosen = devices?.cameras.find((d) => d.deviceId === id);
              set({ cameraDeviceId: id, cameraDeviceLabel: chosen?.label || null });
            }}
          >
            <option value="">{devices?.cameras.length ? defaultDeviceLabel(devices.cameras) : tr_("settings.voice.noCameraFound")}</option>
            {realDevices(devices?.cameras ?? []).map((d, i) => <option key={d.deviceId} value={d.deviceId}>{label(d, i, "cameraN")}</option>)}
          </Select>
        </Field>
      </div>
    </>
  );
}
