import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";

const known = new Set<string>(iconNames);

/**
 * A lucide icon by its name, as a plugin's menu button names it ("heart").
 * Each icon is fetched on its own the first time a menu shows it; this
 * module, with the list of every name, loads only then too. An unknown name
 * shows nothing.
 */
export default function MenuIcon({ name, className }: { name: string; className?: string }) {
  if (!known.has(name)) return null;
  return <DynamicIcon name={name as IconName} size={16} className={className} aria-hidden="true" />;
}
