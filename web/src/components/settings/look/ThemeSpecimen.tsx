import { Hash } from "lucide-react";
import { t } from "@/i18n";
import { tokenStyle, type TokenMap } from "@/lib/look/tokens";
import s from "./Look.module.css";

/**
 * A slice of a conversation in the theme being built: a message with a
 * mention, a link and code, one that mentions you, a code block in every
 * syntax colour, the message box, buttons and the status colours. The
 * settings page around it already wears the theme; this is what it does to
 * the parts of the app the settings never show.
 */
export function ThemeSpecimen({ tokens }: { tokens: TokenMap }) {
  return (
    <div className={s.spec} style={tokenStyle(tokens)} aria-hidden="true">
      <div className={s.specHead}>
        <Hash size={15} />
        {t("settings.themeBuilder.sampleChannel")}
      </div>
      <div className={s.specBody}>
        <div className={s.specMsg} data-hover="">
          <span className={s.specAvatar}>R</span>
          <div className={s.specLine}>
            <span className={s.specName}>Robin</span>
            <span className={s.specTime}>{t("settings.appearance.todayAt420Pm")}</span>
            <div>
              {t("settings.themeBuilder.sampleHello")} <span className={s.specPill}>@Sam</span> <span className={s.specCode}>theme.css</span>{" "}
              <span className={s.specLink}>nexa.example</span>
            </div>
          </div>
        </div>
        <div className={s.specMsg} data-mention="">
          <span className={s.specAvatar} data-alt="">
            S
          </span>
          <div className={s.specLine}>
            <span className={s.specName}>Sam</span>
            <span className={s.specTime}>{t("settings.appearance.todayAt420Pm")}</span>
            <div>{t("settings.themeBuilder.sampleReply")}</div>
            <pre className={s.specBlock} dir="ltr">
              <span data-c="comment">{"// "}{t("settings.themeBuilder.sampleComment")}</span>
              {"\n"}
              <span data-c="keyword">const</span> <span data-c="variable">theme</span> = <span data-c="title">make</span>(<span data-c="string">"dusk"</span>, <span data-c="number">4.5</span>);{"\n"}
              <span data-c="keyword">type</span> <span data-c="type">Look</span> = <span data-c="type">Theme</span>;
            </pre>
          </div>
        </div>
      </div>
      <div className={s.specComposer}>{t("settings.themeBuilder.samplePlaceholder")}</div>
      <div className={s.specFoot}>
        <span className={s.specBtn} data-kind="brand">
          {t("settings.themeBuilder.sampleSave")}
        </span>
        <span className={s.specBtn} data-kind="plain">
          {t("settings.themeBuilder.sampleCancel")}
        </span>
        <span className={s.specBtn} data-kind="positive">
          {t("settings.themeBuilder.sampleAccept")}
        </span>
        <span className={s.specBtn} data-kind="danger">
          {t("settings.themeBuilder.sampleDelete")}
        </span>
      </div>
      <div className={s.specStatus}>
        <span>
          <i style={{ background: "var(--status-online)" }} />
          {t("shell.user.online")}
        </span>
        <span>
          <i style={{ background: "var(--status-idle)" }} />
          {t("shell.user.idle")}
        </span>
        <span>
          <i style={{ background: "var(--status-dnd)" }} />
          {t("settings.themeBuilder.sampleBusy")}
        </span>
        <span className={s.specWarn}>{t("settings.themeBuilder.sampleWarning")}</span>
        <span className={s.specErr}>{t("settings.themeBuilder.sampleError")}</span>
      </div>
    </div>
  );
}
