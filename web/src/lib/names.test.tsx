// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import type { Activity, Channel, PublicUser } from "@/api/types";
import { I18nProvider } from "@/i18n";
import { activityLine } from "./activity";
import { channelDisplayName } from "./names";

const people = Object.fromEntries(["ann", "bob", "carl"].map((id) => [id, { id, username: id, display_name: id[0]!.toUpperCase() + id.slice(1) } as PublicUser]));
const group = { id: "g1", type: "group_dm", name: "", recipient_ids: ["me", "ann", "bob", "carl"] } as unknown as Channel;
const game: Activity = { name: "Minecraft", type: 0, created_at: 0 };

function Probe({ out }: { out: string[] }) {
  out.push(`${activityLine(game)} | ${channelDisplayName(group, people, "me")}`);
  return null;
}

async function inLanguage(locale: string): Promise<string> {
  const out: string[] = [];
  render(
    <I18nProvider locale={locale}>
      <Probe out={out} />
    </I18nProvider>,
  );
  // the catalogue arrives after the first render
  await waitFor(() => expect(out.length).toBeGreaterThan(locale === "en" ? 0 : 1));
  return out.at(-1)!;
}

describe("sentences put together in the reader's language", () => {
  it("reads as English does in English", async () => {
    expect(await inLanguage("en")).toBe("Playing Minecraft | Ann, Bob, Carl");
  });

  it("puts the name where Japanese puts it, and joins the list with its own mark", async () => {
    expect(await inLanguage("ja")).toBe("Minecraftをプレイ中 | Ann、Bob、Carl");
  });

  it("joins a German list with und", async () => {
    expect(await inLanguage("de")).toBe("Spielt Minecraft | Ann, Bob und Carl");
  });
});
