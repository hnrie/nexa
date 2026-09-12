import type { SelectHTMLAttributes } from "react";
import s from "./TextInput.module.css";

/** A native select styled like the text inputs. */
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={[s.input, className ?? ""].join(" ")} {...rest}>
      {children}
    </select>
  );
}
