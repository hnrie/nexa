import { Link } from "lucide-react";
import { useId } from "react";
import { Tooltip } from "@/components/common/Tooltip";
import { useUI } from "@/stores/ui";
import s from "./GroupAdd.module.css";

import { t } from "@/i18n";

/**
 * Shown in place of a checkbox, in Select Friends while a new group is being
 * put together, for a friend who joins group chats only from an invite link
 * (a group that exists offers Send Join Request instead: JoinRequestButton).
 * Pointing at it or focusing it explains; the explanation is its description
 * for a screen reader too, and a tap says it where there is no pointer to
 * hover with.
 */
export function LinkOnlyTag({ name }: { name: string }) {
  const hintId = useId();
  const tip = t("groupAdd.linkOnlyTip", { name });
  const label = t("groupAdd.linkOnly");
  return (
    <>
      <Tooltip text={tip}>
        <button type="button" className={s.linkOnly} aria-label={label} aria-describedby={hintId} onClick={() => useUI.getState().toast(tip, "info")} data-testid="link-only">
          <Link size={14} aria-hidden="true" />
          <span>{label}</span>
        </button>
      </Tooltip>
      <span id={hintId} className="visually-hidden">
        {tip}
      </span>
    </>
  );
}
