// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { PublicUser } from "@/api/types";
import { I18nProvider } from "@/i18n";
import { useAuth } from "@/stores/auth";
import { useUsers } from "@/stores/users";
import { personError, personList, personText } from "./personText";

const people = [
  { id: "1", username: "alex1", display_name: "Alex", name_style: { font: "comic", effect: "gradient", colors: [0xff0000, 0x0000ff] } },
  { id: "2", username: "alex2", display_name: "Alex", name_style: { font: "", effect: "glow", colors: [0x00ff00] } },
  { id: "3", username: "cara", display_name: "Cara", name_style: null },
] as PublicUser[];

beforeEach(() => {
  useAuth.setState({ me: null });
  useUsers.setState({ byId: Object.fromEntries(people.map((user) => [user.id, user])) });
});
afterEach(cleanup);

it("places a styled person inside the translated sentence without styling the prose", async () => {
  const { container } = render(<I18nProvider locale="ja">{personText("friends.friendRequestSent", "1", "Nickname")}</I18nProvider>);
  await waitFor(() => expect(container.textContent).toBe("Nickname へのフレンド申請を送りました。"));
  const name = screen.getByText("Nickname");
  expect(name.className).toContain("ns-gradient");
  expect(name.style.getPropertyValue("--ns-family")).toBe('"Comic Neue"');
  expect(name.textContent).toBe("Nickname");
});

it("keeps duplicate display names bound to the right identities in a translated list", () => {
  // Construct the list during the provider's render, after it selects English.
  function Names() { return <div>{personList(people)}</div>; }
  const { container } = render(<I18nProvider locale="en"><Names /></I18nProvider>);
  expect(container.textContent).toBe("Alex, Alex, Cara");
  const names = screen.getAllByText("Alex");
  expect(names[0]!.className).toContain("ns-gradient");
  expect(names[1]!.className).toContain("ns-glow");
});

it("preserves a specific server error and only enriches the named fallback", () => {
  const rich = personText("friends.friendRequestSent", "1", "Alex");
  expect(personError("Server supplied a reason", "Fallback", rich)).toBe("Server supplied a reason");
  expect(personError("Fallback", "Fallback", rich)).toBe(rich);
});
