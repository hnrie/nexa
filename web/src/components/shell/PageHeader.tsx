import { Menu } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useUI } from "@/stores/ui";
import s from "./PageHeader.module.css";

import { t } from "@/i18n";
/** The hamburger that opens the navigation drawer on phones; nothing on desktop. */
export function PageHeaderButtons() {
  const mobile = useIsMobile();
  const setLeftOpen = useUI((u) => u.setLeftOpen);
  if (!mobile) return null;
  return (
    <button className={s.burger} aria-label={t("shell.pageHeader.openNavigation")} onClick={() => setLeftOpen(true)}>
      <Menu size={22} />
    </button>
  );
}
