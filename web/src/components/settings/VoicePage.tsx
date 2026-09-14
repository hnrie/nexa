import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/common/Button";
import { Select } from "@/components/common/Select";
import { Field } from "@/components/common/TextInput";
import { Toggle } from "@/components/common/Toggle";
import { useSettings, type VoiceSettings } from "@/stores/settings";
import { useVoice } from "@/stores/voice";
import { LevelMeter, audioContext, defaultDeviceLabel, describeInput, getMic, holdAudio, lastInputChoice, listDevices, realDevices, sensitivityToThreshold, sentStream, type Devices } from "@/voice/media";
import { inVoice } from "@/voice/session";
import st from "./Settings.module.css";
import v from "@/components/voice/Voice.module.css";

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
  const [wrongDevice, setWrongDevice] = useState(false);
  const [capturing, setCapturing] = useState(false);
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
      setDiag(`The microphone could not be opened: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
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
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  const level = testing ? testLevel : inVoice() ? liveLevel : 0;
  const threshold = settings.autoSensitivity ? null : sensitivityToThreshold(settings.sensitivity);
  const label = (d: MediaDeviceInfo, i: number, kind: string) => d.label || `${kind} ${i + 1}`;
  return (
    <>
      <h2 className={st.title}>Voice & Video</h2>
      <div className={st.form}>
        <div className={`${st.twoCol} ${st.twoEqual}`}>
          <Field label="Input device">
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
              {realDevices(devices?.inputs ?? []).map((d, i) => <option key={d.deviceId} value={d.deviceId}>{label(d, i, "Microphone")}</option>)}
            </Select>
          </Field>
          <Field label="Output device">
            <Select
              value={settings.outputDeviceId ?? ""}
              onChange={(e) => {
                const id = e.target.value || null;
                const chosen = devices?.outputs.find((d) => d.deviceId === id);
                set({ outputDeviceId: id, outputDeviceLabel: chosen?.label || null });
              }}
            >
              <option value="">{defaultDeviceLabel(devices?.outputs ?? [])}</option>
              {realDevices(devices?.outputs ?? []).map((d, i) => <option key={d.deviceId} value={d.deviceId}>{label(d, i, "Speaker")}</option>)}
            </Select>
          </Field>
        </div>
        <div className={`${st.twoCol} ${st.twoEqual}`}>
          <Field label={`Input volume — ${settings.inputVolume}%`}>
            <input type="range" className={st.slider} min={0} max={200} value={settings.inputVolume} onChange={(e) => set({ inputVolume: Number(e.target.value) })} />
          </Field>
          <Field label={`Output volume — ${settings.outputVolume}%`}>
            <input type="range" className={st.slider} min={0} max={200} value={settings.outputVolume} onChange={(e) => set({ outputVolume: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label="Mic test" hint="Speak and watch both meters. The top one is your microphone; the bottom one is what a call would actually send. The yellow mark is your voice-activity threshold.">
          <div>
            <Button size="sm" variant={testing ? "danger" : "secondary"} onClick={() => (testing ? stopTest() : void startTest())} disabled={starting} data-testid="mic-test">{testing ? "Stop test" : "Let's check"}</Button>
            <div className={v.meter} aria-label="Input level" data-testid="mic-level">
              <div className={v.meterFill} style={{ width: `${Math.round(level * 100)}%` }} />
              {threshold !== null ? <div className={v.meterMark} style={{ left: `${Math.round(threshold * 100)}%` }} /> : null}
            </div>
            {testing ? (
              <>
                <div className={v.meter} aria-label="Level others would hear" data-testid="sent-level" style={{ marginTop: 6 }}>
                  <div className={v.meterFill} data-sent="true" style={{ width: `${Math.round(sentLevel * 100)}%` }} />
                </div>
                <p className={st.hint} style={{ marginTop: 6 }}>Top: your microphone. Bottom: what the call sends.</p>
              </>
            ) : null}
            {wrongDevice ? (
              <div className={st.dangerBox} style={{ marginTop: 8 }} data-testid="wrong-device">
                The microphone you picked is not available right now, so this is the system default. Pick it again above if it is plugged in.
              </div>
            ) : null}
            {diag ? <pre className={v.diag} data-testid="mic-diagnostics">{diag}</pre> : null}
          </div>
        </Field>
        <h5 className={st.h5}>Input mode</h5>
        <label className={st.radio} data-on={settings.mode === "vad"}>
          <input type="radio" checked={settings.mode === "vad"} onChange={() => set({ mode: "vad" })} />
          <span className={st.radioText}><span className={st.radioLabel}>Voice Activity</span><span className={st.radioDesc}>Transmit whenever you talk.</span></span>
        </label>
        <label className={st.radio} data-on={settings.mode === "ptt"}>
          <input type="radio" checked={settings.mode === "ptt"} onChange={() => set({ mode: "ptt" })} />
          <span className={st.radioText}><span className={st.radioLabel}>Push to Talk</span><span className={st.radioDesc}>Transmit only while you hold a key.</span></span>
        </label>
        {settings.mode === "ptt" ? (
          <Field label="Push-to-talk key" hint="Click the box, then press the key you want. Works while this tab is focused.">
            <button type="button" className={v.keyCapture} data-capturing={capturing} onClick={() => setCapturing(true)}>
              <span>{capturing ? "Press a key…" : settings.pttKey}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{capturing ? "Esc to cancel" : "Change"}</span>
            </button>
          </Field>
        ) : (
          <>
            <Toggle checked={settings.autoSensitivity} onChange={(on) => set({ autoSensitivity: on })} label="Automatically determine input sensitivity" description="Learns your background noise and only counts speech above it." />
            {!settings.autoSensitivity ? (
              <Field label={`Input sensitivity — ${settings.sensitivity} dB`}>
                <input type="range" className={st.slider} min={-100} max={0} value={settings.sensitivity} onChange={(e) => set({ sensitivity: Number(e.target.value) })} />
              </Field>
            ) : null}
          </>
        )}
        <h5 className={st.h5}>Voice processing</h5>
        <Toggle checked={settings.noiseSuppression} onChange={(on) => set({ noiseSuppression: on })} label="Noise suppression" description="Filters keyboard clatter and fans with the browser's built-in suppressor." />
        <Toggle checked={settings.echoCancellation} onChange={(on) => set({ echoCancellation: on })} label="Echo cancellation" />
        <Toggle checked={settings.autoGain} onChange={(on) => set({ autoGain: on })} label="Automatic gain control" />
        <Field label="Camera">
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
            <option value="">{devices?.cameras.length ? defaultDeviceLabel(devices.cameras) : "No camera found"}</option>
            {realDevices(devices?.cameras ?? []).map((d, i) => <option key={d.deviceId} value={d.deviceId}>{label(d, i, "Camera")}</option>)}
          </Select>
        </Field>
      </div>
    </>
  );
}
