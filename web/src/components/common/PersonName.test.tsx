// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import type { MeUser, PublicUser } from "@/api/types";
import { useAuth } from "@/stores/auth";
import { useUsers } from "@/stores/users";
import { useServers, type ServerState } from "@/stores/servers";
import { PersonName } from "./PersonName";

const styled = { font: "comic", effect: "gradient", colors: [0xff0000, 0x0000ff] };
const person = (name_style: unknown) => ({ id: "2", name_style }) as PublicUser;
beforeEach(() => {
  useAuth.setState({ me: null });
  useUsers.setState({ byId: {} });
  useServers.setState({ byId: {} });
});
afterEach(cleanup);

it("keeps the supplied nickname while following live style changes and explicit resets", () => {
  render(<PersonName user={person(styled)}>Nickname</PersonName>);
  const label = screen.getByText("Nickname");
  expect(label.className).toContain("ns-gradient");
  expect(label.style.getPropertyValue("--ns-family")).toBe('"Comic Neue"');
  act(() => useUsers.setState({ byId: { "2": person({ font: "", effect: "glow", colors: [0x00ff00] }) } }));
  expect(label.className).toContain("ns-glow");
  expect(label.className).not.toContain("ns-gradient");
  act(() => useUsers.setState({ byId: { "2": person(null) } }));
  expect(label.className).toBe("");
  expect(label.style.getPropertyValue("--ns-family")).toBe("");
});

it("shows an own-profile save immediately, before the gateway updates the user cache", () => {
  useUsers.setState({ byId: { "2": person(styled) } });
  useAuth.setState({ me: person(styled) as MeUser });
  render(<PersonName userId="2">Me</PersonName>);
  expect(screen.getByText("Me").className).toContain("ns-gradient");
  act(() => useAuth.setState({ me: person(null) as MeUser }));
  expect(screen.getByText("Me").className).toBe("");
});

it("keeps the custom font when a server role overrides the effect colours", () => {
  useUsers.setState({ byId: { "2": person(styled) } });
  useServers.setState({ byId: { s: { members: { "2": { role_ids: ["r"] } }, roles: { r: { color: 0x00ff00, position: 1 } } } as unknown as ServerState } });
  render(<PersonName userId="2" serverId="s">Member</PersonName>);
  const label = screen.getByText("Member");
  expect(label.className).toBe("ns-font");
  expect(label.style.color).toBe("rgb(0, 255, 0)");
  expect(label.style.getPropertyValue("--ns-family")).toBe('"Comic Neue"');
  expect(label.style.getPropertyValue("--ns-c1")).toBe("");
});
