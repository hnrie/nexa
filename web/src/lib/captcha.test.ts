// @vitest-environment jsdom
import { api } from "@/api/client";
import { captchaToken, loadCaptchaConfig } from "./captcha";

type Opts = Record<string, (arg?: string) => void>;

// the script's onload, which says the API is ready (jsdom never runs the script)
const ready = (): void => (window as unknown as { nexaHCaptchaReady?: () => void }).nexaHCaptchaReady?.();

describe("the captcha sheet", () => {
  let rendered: Opts | null = null;
  beforeEach(async () => {
    rendered = null;
    api.request = <T>(): Promise<T> => Promise.resolve({ captcha: { provider: "hcaptcha", site_key: "k" } } as T);
    window.hcaptcha = {
      render: (_el: HTMLElement, opts: Record<string, unknown>) => {
        rendered = opts as Opts;
        return "w1";
      },
      execute: () => undefined,
      remove: () => undefined,
    };
    await loadCaptchaConfig();
  });
  const rendering = (): Promise<void> =>
    vi.waitFor(() => {
      ready();
      expect(rendered).not.toBeNull();
    });
  afterEach(() => {
    delete window.hcaptcha;
    document.body.innerHTML = "";
  });

  it("is a modal dialog in the reader's language, takes focus when it shows and gives it back", async () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    const token = captchaToken("login");
    await rendering();
    const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Captcha");
    rendered!["open-callback"]!();
    expect(dialog.contains(document.activeElement)).toBe(true);
    rendered!["callback"]!("tok");
    await expect(token).resolves.toBe("tok");
    expect(document.activeElement).toBe(button);
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("closes on Escape, as every other sheet in the app does", async () => {
    const token = captchaToken("login");
    await rendering();
    rendered!["open-callback"]!();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect(token).rejects.toMatchObject({ code: "captcha_cancelled" });
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("is cancelled when the challenge is closed", async () => {
    const token = captchaToken("login");
    await rendering();
    rendered!["open-callback"]!();
    rendered!["close-callback"]!();
    await expect(token).rejects.toMatchObject({ code: "captcha_cancelled" });
  });
});
