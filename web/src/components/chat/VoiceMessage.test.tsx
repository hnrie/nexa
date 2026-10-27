// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { transcribeVoice } from "@/lib/transcribe";
import { VoiceMessage } from "./VoiceMessage";

vi.mock("@/lib/transcribe", () => ({ transcribeVoice: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const recording = () => render(<VoiceMessage src="blob:recording" duration={4} wave={undefined} loading={false} onLoad={() => {}} />);

it("shows no idle hint, then download percentage, working state and the transcript", async () => {
  let report!: Parameters<typeof transcribeVoice>[1];
  let finish!: (text: string) => void;
  vi.mocked(transcribeVoice).mockImplementation((_src, phase) => {
    report = phase;
    return new Promise((resolve) => { finish = resolve; });
  });
  recording();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByText(/Private, on-device/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Transcribe" }));
  await waitFor(() => expect(transcribeVoice).toHaveBeenCalledOnce());
  act(() => report("loading", 42));
  expect(screen.getByRole("status").textContent).toBe("Downloading… 42%");
  act(() => report("working"));
  expect(screen.getByRole("status").textContent).toBe("Transcribing on this device…");
  await act(async () => finish("The meeting is tomorrow."));
  expect(screen.getByText("The meeting is tomorrow.")).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
});

it("cancels a download without showing a failure or leaving a progress hint", async () => {
  vi.mocked(transcribeVoice).mockImplementation((_src, _phase, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
  }));
  recording();
  fireEvent.click(screen.getByRole("button", { name: "Transcribe" }));
  await waitFor(() => expect(transcribeVoice).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Cancel Transcription" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Transcribe" })).toBeTruthy());
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});
