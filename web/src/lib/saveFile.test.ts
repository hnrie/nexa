// @vitest-environment jsdom
import { pickSaveFile, saveBlob } from "./saveFile";
import { saveImage } from "./imageActions";
import { useUI } from "@/stores/ui";

afterEach(() => {
  vi.unstubAllGlobals();
  useUI.getState().closeAllModals();
});

it("opens the picker before loading a full image and stops on cancel", async () => {
  const load = vi.fn();
  const picker = vi.fn().mockRejectedValue(new DOMException("cancel", "AbortError"));
  vi.stubGlobal("showSaveFilePicker", picker);
  await saveImage(load, "original.png");
  expect(picker).toHaveBeenCalledWith({ suggestedName: "original.png" });
  expect(load).not.toHaveBeenCalled();
});

it("does not silently download somewhere else if the picker fails", async () => {
  vi.stubGlobal("showSaveFilePicker", vi.fn().mockRejectedValue(new DOMException("denied", "SecurityError")));
  await expect(pickSaveFile("a.txt")).rejects.toThrow("denied");
});

it("writes and closes the chosen file, or aborts after a disk error", async () => {
  const out = { write: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined) };
  const handle = { createWritable: vi.fn().mockResolvedValue(out) };
  const blob = new Blob(["original"]);
  await saveBlob(blob, "a.txt", handle);
  expect(out.write).toHaveBeenCalledWith(blob);
  expect(out.close).toHaveBeenCalledOnce();
  out.write.mockRejectedValueOnce(new Error("disk full"));
  await expect(saveBlob(blob, "a.txt", handle)).rejects.toThrow("disk full");
  expect(out.abort).toHaveBeenCalledOnce();
});

it("offers the ready file after a slow mobile fetch so a fresh tap can open the system save sheet", async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { canShare: () => true, share, userActivation: { isActive: false } });
  await saveBlob(new Blob(["hello"], { type: "text/plain" }), "hello.txt", undefined);
  expect(share).not.toHaveBeenCalled();
  const modal = useUI.getState().modal!;
  expect(modal.kind).toBe("confirm");
  await (modal.props!.onConfirm as () => Promise<void>)();
  expect(share).toHaveBeenCalledOnce();
  expect(share.mock.calls[0]![0].files[0].name).toBe("hello.txt");
});
