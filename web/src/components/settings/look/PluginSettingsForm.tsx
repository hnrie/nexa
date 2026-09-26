import { useState } from "react";
import { Field, TextInput } from "@/components/common/TextInput";
import { Select } from "@/components/common/Select";
import { Toggle } from "@/components/common/Toggle";
import type { PluginSetting, SettingValue } from "@/lib/look/plugins/api";
import { settingValues } from "@/lib/look/plugins/runtime";
import { ColourField } from "./ColourField";
import s from "./Look.module.css";

/** A text or number box that saves when it is left, not on every key: each save goes to every device. */
function Committed({ value, onCommit, type, setting }: { value: string; onCommit: (v: string) => void; type: "text" | "number"; setting: PluginSetting }) {
  const [text, setText] = useState(value);
  const [was, setWas] = useState(value);
  if (value !== was) {
    setWas(value);
    setText(value);
  }
  return (
    <TextInput
      value={text}
      type={type}
      dir="auto"
      placeholder={setting.type === "text" ? setting.placeholder : undefined}
      maxLength={setting.type === "text" ? setting.maxLength : undefined}
      min={setting.type === "number" ? setting.min : undefined}
      max={setting.type === "number" ? setting.max : undefined}
      step={setting.type === "number" ? setting.step : undefined}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(text);
      }}
    />
  );
}

/**
 * The settings a plugin declared, drawn with the app's own controls. Labels
 * are the plugin's own words, in whatever language it wrote them.
 */
export function PluginSettingsForm({ schema, saved, onChange }: { schema: PluginSetting[]; saved: Record<string, unknown>; onChange: (values: Record<string, SettingValue>) => void }) {
  const values = settingValues(schema, saved);
  const set = (key: string, v: SettingValue) => onChange({ ...values, [key]: v });
  return (
    <div className={s.settingsBox} data-testid="plugin-settings">
      {schema.map((st) => {
        if (st.type === "toggle") return <Toggle key={st.key} checked={values[st.key] === true} onChange={(v) => set(st.key, v)} label={st.label} description={st.description} />;
        if (st.type === "color")
          return <ColourField key={st.key} label={st.label} hint={st.description} value={String(values[st.key])} onChange={(v) => set(st.key, v.slice(0, 7))} />;
        return (
          <Field key={st.key} label={st.label} hint={st.description}>
            {st.type === "select" ? (
              <Select value={String(values[st.key])} onChange={(e) => set(st.key, e.target.value)}>
                {st.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Committed
                setting={st}
                type={st.type === "number" ? "number" : "text"}
                value={String(values[st.key])}
                onCommit={(v) => {
                  if (st.type !== "number") return set(st.key, v);
                  const n = Number(v);
                  if (Number.isFinite(n)) set(st.key, n);
                }}
              />
            )}
          </Field>
        );
      })}
    </div>
  );
}
