import { personText } from "@/lib/personText";
import { PersonName } from "@/components/common/PersonName";
import { Check, Plus, X } from "lucide-react";
import type { RefObject } from "react";
import { Avatar } from "@/components/common/Avatar";
import { Tooltip } from "@/components/common/Tooltip";
import { canAddAccount, MAX_ACCOUNTS, removeAccount, switchAccount, useAccounts } from "@/lib/accounts";
import { useUI } from "@/stores/ui";
import s from "./UserPanel.module.css";
import f from "./AccountsFlyout.module.css";

import { t } from "@/i18n";

/**
 * Switch Accounts' side menu (UserPanel): every account signed in on this
 * device, the open one ticked, a way to log each other one out, then Add
 * Another Account (modals/AddAccountModal.tsx).
 */
export default function AccountsFlyout({ meId, flyoutRef, closeMenu, back }: { meId: string; flyoutRef: RefObject<HTMLDivElement>; closeMenu: () => void; back: () => void }) {
  const accounts = useAccounts((a) => a.list);
  const openModal = useUI((u) => u.openModal);
  const toast = useUI((u) => u.toast);

  const askRemove = (id: string, name: string) => {
    closeMenu();
    openModal("confirm", {
      title: personText("accounts.removeTitle", id, name),
      body: t("accounts.removeBody"),
      confirmLabel: t("accounts.remove"),
      danger: true,
      onConfirm: () => removeAccount(id),
    });
  };

  return (
    <div
      ref={flyoutRef}
      className={f.flyout}
      role="menu"
      aria-label={t("accounts.switchAccounts")}
      onKeyDown={(e) => {
        // back to Switch Accounts, the way the arrow came in
        if (e.key !== (document.documentElement.dir === "rtl" ? "ArrowRight" : "ArrowLeft")) return;
        e.preventDefault();
        e.stopPropagation();
        back();
      }}
    >
      {accounts.map((a) => (
        <div key={a.id} className={f.account}>
          {a.id === meId ? (
            // who is open now: no switch to make
            <div className={[f.accountOpt, f.accountHere].join(" ")} role="menuitem" aria-disabled="true">
              <Avatar id={a.id} avatarId={a.avatar_id} name={a.display_name} size={32} />
              <span className={f.identity}>
                <PersonName user={a}>{a.display_name}</PersonName>
                <span className={f.username}>@{a.username}</span>
              </span>
              <span className={f.trailing}><Check size={16} aria-label={t("accounts.current")} /></span>
            </div>
          ) : (
            <>
              <button className={f.accountOpt} role="menuitem" onClick={() => { closeMenu(); void switchAccount(a.id); }} data-testid="menu-account">
                <Avatar id={a.id} avatarId={a.avatar_id} name={a.display_name} size={32} />
                <span className={f.identity}>
                  <PersonName user={a}>{a.display_name}</PersonName>
                  <span className={f.username}>@{a.username}</span>
                </span>
              </button>
              <Tooltip text={t("accounts.remove")} className={f.trailing}>
                <button className={f.accountRemove} role="menuitem" aria-label={t("accounts.removeTitle", { name: a.display_name })} onClick={() => askRemove(a.id, a.display_name)}>
                  <X size={16} strokeWidth={1.5} />
                </button>
              </Tooltip>
            </>
          )}
        </div>
      ))}
      {accounts.length ? <div className={s.sep} role="separator" /> : null}
      <button
        className={f.addAccount}
        role="menuitem"
        onClick={() => {
          closeMenu();
          if (canAddAccount()) openModal("addAccount");
          else toast(t("accounts.tooMany", { count: MAX_ACCOUNTS }));
        }}
        data-testid="menu-add-account"
      >
        <span className={f.addIcon}><Plus size={18} strokeWidth={1.75} /></span>
        <span>{t("accounts.addAnotherAccount")}</span>
      </button>
    </div>
  );
}
