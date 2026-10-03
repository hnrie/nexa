import { useLayoutEffect, useRef, type SelectHTMLAttributes } from "react";
import s from "./TextInput.module.css";

/**
 * A native select styled like the text inputs. Where the browser draws its
 * own themed select (Chromium's customizable select), the chosen option sits
 * in a button of the select's own, so a long one (a headset's full device
 * name) stays on one line and ends in an ellipsis instead of wrapping out of
 * the box. The button is added here rather than rendered, since React does not
 * know a select may hold one; other browsers draw their own select and leave
 * it unseen.
 */
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  const ref = useRef<HTMLSelectElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof CSS === "undefined" || !CSS.supports?.("appearance: base-select")) return;
    if (el.querySelector(":scope > button")) return;
    const button = document.createElement("button");
    button.appendChild(document.createElement("selectedcontent"));
    el.prepend(button);
  }, []);
  return (
    <select ref={ref} className={[s.input, className ?? ""].join(" ")} {...rest}>
      {children}
    </select>
  );
}
