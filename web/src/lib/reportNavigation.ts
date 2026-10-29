import {
  useLocation,
  useNavigate,
  type NavigateOptions,
} from "react-router-dom";

export function reportReturnPath(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const path = (state as { reportReturnTo?: unknown }).reportReturnTo;
  return typeof path === "string" &&
    /^\/channels\/@admin\/reports\/\d{1,20}(\?[^#]*)?$/.test(path)
    ? path
    : null;
}
/** Keep report context while inspecting related staff pages, including refresh. */
export function useReportNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = reportReturnPath(location.state);
  return {
    returnTo,
    nav: (to: string, options?: NavigateOptions) =>
      navigate(to, {
        ...options,
        ...(returnTo
          ? { state: { ...options?.state, reportReturnTo: returnTo } }
          : {}),
      }),
    back: (fallback: string) => navigate(returnTo ?? fallback),
  };
}
