import { describe, expect, it } from "vitest";
import { namedByHook, sameHookSender, sanitizeHook } from "./webhookMessage";

describe("an app's message", () => {
  const raw = {
    name: "Lab Bot",
    content: "pong",
    application_id: "77",
    interaction: { id: "5", type: 2, user_id: "9", name: "ping", command_type: 1, trigger: { id: "4", type: 2, user_id: "9", name: "form" } },
    stickers: [{ id: "8", name: "wave", blob_id: "12", format: "apng" }, { id: "x" }],
    components: [
      { type: 1, components: [{ type: 3, custom_id: "pick", placeholder: "Pick one", min_values: 1, max_values: 2, options: [{ label: "Red", value: "red", default: true }, { label: 5 }] }] },
      { type: 1, components: [{ type: 5, custom_id: "who", default_values: [{ id: "9", type: "user" }, { id: "x", type: "user" }] }] },
    ],
  };

  it("keeps the app, what it answers and its stickers", () => {
    const h = sanitizeHook(raw)!;
    expect(h.application_id).toBe("77");
    expect(h.interaction).toMatchObject({ id: "5", type: 2, user_id: "9", name: "ping", command_type: 1, trigger: { id: "4", name: "form" } });
    expect(h.stickers).toEqual([{ id: "8", name: "wave", blob_id: "12", format: "apng" }]);
  });

  it("keeps what its select menus offer, and drops what is malformed", () => {
    const h = sanitizeHook(raw)!;
    const select = h.components[0]!.components[0]!;
    expect(select).toMatchObject({ type: 3, custom_id: "pick", placeholder: "Pick one", min_values: 1, max_values: 2 });
    expect(select.options).toEqual([{ label: "Red", value: "red", default: true }]);
    expect(h.components[1]!.components[0]!.default_values).toEqual([{ id: "9", type: "user" }]);
  });

  it("goes by its bot, where a webhook's goes by the name it was sent with", () => {
    const h = sanitizeHook(raw)!;
    expect(namedByHook({ hook: h })).toBe(false);
    expect(namedByHook({ hook: h, webhook_id: "3" })).toBe(true);
    expect(sameHookSender(h, { ...h, name: "Renamed" })).toBe(true);
    expect(sameHookSender(h, { ...h, application_id: "78" })).toBe(false);
  });
});
