import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/common/Button";
import { hasSavedSession } from "@/stores/auth";
import { AuthLayout, usePageTitle } from "./AuthLayout";
import s from "./Auth.module.css";

import { t } from "@/i18n";

/**
 * An address that is nothing here: a link typed wrong, or one to something
 * that has moved. It used to send the visitor to the login page, or a signed-in
 * one to Friends, without a word, which read as the link having worked and
 * dropped them somewhere unrelated.
 */
export default function NotFoundPage() {
  const nav = useNavigate();
  const signedIn = hasSavedSession();
  usePageTitle(t("notFound.title"));
  return (
    <AuthLayout title={t("notFound.title")} subtitle={t("notFound.body")} width={420}>
      <Button size="lg" block onClick={() => nav(signedIn ? "/channels/@me" : "/", { replace: true })} data-testid="not-found-go">
        {signedIn ? t("notFound.openNexa") : t("notFound.home")}
      </Button>
      {signedIn ? null : (
        <p className={s.foot} style={{ margin: 0, textAlign: "center" }}>
          <Link to="/login">{t("login.logIn")}</Link>
        </p>
      )}
    </AuthLayout>
  );
}
