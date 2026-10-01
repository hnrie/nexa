import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import type { AttachmentMeta } from "@/crypto/message";
import type { NoteDoc } from "./model";
import { failureKind, withoutRefusedFiles } from "./open";

const file = (blob: string, copy?: string): AttachmentMeta => ({ blob_id: blob, name: "a.png", type: "image/png", size: 10, key: "a2V5", ...(copy ? { preview: { blob_id: copy, key: "a2V5", size: 4, type: "image/webp", w: 4, h: 4 } } : {}) });

function refusal(files: unknown): ApiError {
  const err = new ApiError(400, "note_file", "A file in this note could not be kept. Add it again.");
  err.details = { files };
  return err;
}

describe("what a failed save means", () => {
  it("tells a note that moved on from a connection that is down from a refusal", () => {
    expect(failureKind(new ApiError(409, "note_stale", "changed"))).toBe("stale");
    expect(failureKind(new ApiError(0, "network", "down"))).toBe("offline");
    expect(failureKind(new ApiError(0, "timeout", "slow"))).toBe("offline");
    expect(failureKind(new ApiError(503, "http_503", "restarting"))).toBe("offline");
    expect(failureKind(new ApiError(429, "rate_limited", "slow down"))).toBe("offline");
    expect(failureKind(new ApiError(403, "note_role", "no"))).toBe("other");
    expect(failureKind(new ApiError(400, "bad_note", "no"))).toBe("other");
    expect(failureKind(new Error("anything else"))).toBe("other");
  });
});

describe("a save refused over files the server will not take", () => {
  const doc: NoteDoc = { title: "T", md: "top\n![a](nexa-file:a)\nmiddle\n![b](nexa-file:b)\nend\n", files: { a: file("1"), b: file("2", "22") } };

  it("leaves the files named out of the note", () => {
    const fixed = withoutRefusedFiles(refusal(["1"]), doc);
    expect(fixed?.md).toBe("top\nmiddle\n![b](nexa-file:b)\nend\n");
    expect(Object.keys(fixed?.files ?? {})).toEqual(["b"]);
    expect(fixed?.title).toBe("T");
  });

  it("keeps a picture whose small copy alone was refused", () => {
    const fixed = withoutRefusedFiles(refusal(["22"]), doc);
    expect(fixed?.md).toBe(doc.md);
    expect(fixed?.files["b"]).toEqual(file("2"));
  });

  it("has no way around any other refusal, or one that names nothing this note holds", () => {
    expect(withoutRefusedFiles(new ApiError(403, "note_role", "no"), doc)).toBeNull();
    expect(withoutRefusedFiles(refusal(["999"]), doc)).toBeNull();
    expect(withoutRefusedFiles(refusal([]), doc)).toBeNull();
    expect(withoutRefusedFiles(refusal("1"), doc)).toBeNull();
    expect(withoutRefusedFiles(new Error("x"), doc)).toBeNull();
  });
});
