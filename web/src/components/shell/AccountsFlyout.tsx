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
      title: t("accounts.removeTitle", { name }),
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
            <div className={[s.opt, f.accountOpt, f.accountHere].join(" ")}>
              <Avatar id={a.id} avatarId={a.avatar_id} name={a.display_name} size={24} />
              <span className={s.optText} style={{ flex: 1 }}>
                <span>{a.display_name}</span>
                <span className={s.optSub}>@{a.username}</span>
              </span>
              <Check size={16} aria-label={t("accounts.current")} />
            </div>
          ) : (
            <>
              <button className={[s.opt, f.accountOpt].join(" ")} role="menuitem" onClick={() => { closeMenu(); void switchAccount(a.id); }} data-testid="menu-account">
                <Avatar id={a.id} avatarId={a.avatar_id} name={a.display_name} size={24} />
                <span className={s.optText}>
                  <span>{a.display_name}</span>
                  <span className={s.optSub}>@{a.username}</span>
                </span>
              </button>
              <Tooltip text={t("accounts.remove")}>
                <button className={f.accountRemove} role="menuitem" aria-label={t("accounts.removeTitle", { name: a.display_name })} onClick={() => askRemove(a.id, a.display_name)}>
                  <X size={14} />
                </button>
              </Tooltip>
            </>
          )}
        </div>
      ))}
      {accounts.length ? <div className={s.sep} role="separator" /> : null}
      <button
        className={s.opt}
        role="menuitem"
        onClick={() => {
          closeMenu();
          if (canAddAccount()) openModal("addAccount");
          else toast(t("accounts.tooMany", { count: MAX_ACCOUNTS }));
        }}
        data-testid="menu-add-account"
      >
        <Plus size={16} />
        <span className={s.optText}><span>{t("accounts.addAnotherAccount")}</span></span>
      </button>
    </div>
  );
}
