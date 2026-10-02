import { applyDoc, bodyOf, docFromBody, hasDoc, mergeBody, readDoc, startingClient, startingDoc, Y } from "./ydoc";

describe("a note as a document", () => {
  const start = { title: "Old", md: "first line\nsecond line", files: {} };

  it("is made the same on every device from a body that has no document", () => {
    const a = startingDoc("n1", 4, start);
    const b = startingDoc("n1", 4, start);
    expect(Y.encodeStateAsUpdate(a)).toEqual(Y.encodeStateAsUpdate(b));
    // so each device's edits fit on the other's, and the text is there once
    applyDoc(a, { md: "first line!\nsecond line" }, "local");
    applyDoc(b, { md: "first line\nsecond line?" }, "local");
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(readDoc(a).md).toBe("first line!\nsecond line?");
    expect(readDoc(b).md).toBe(readDoc(a).md);
  });

  it("differs between versions and notes, so two starts never collide", () => {
    expect(startingClient("n1", 4)).not.toBe(startingClient("n1", 5));
    expect(startingClient("n1", 4)).not.toBe(startingClient("n2", 4));
  });

  it("saves its whole self in the body, with the text beside it, and opens from it", () => {
    const doc = startingDoc("n1", 1, start);
    applyDoc(doc, { title: "New", md: "changed" }, "local");
    const body = bodyOf(doc, { md: "changed", files: {} });
    expect(hasDoc(body)).toBe(true);
    expect(body.md).toBe("changed");
    const again = docFromBody("n1", 2, "ignored", JSON.parse(JSON.stringify(body)));
    expect(readDoc(again)).toEqual({ title: "New", md: "changed", files: {} });
  });

  it("takes in another saved copy beside its own changes", () => {
    const a = startingDoc("n1", 1, start);
    const b = docFromBody("n1", 1, "Old", bodyOf(a, { md: start.md, files: {} }));
    applyDoc(a, { md: "A: " + start.md }, "local");
    applyDoc(b, { md: start.md + " :B" }, "local");
    expect(mergeBody(a, bodyOf(b, readDoc(b)), "remote")).toBe(true);
    expect(readDoc(a).md).toBe("A: first line\nsecond line :B");
  });

  it("reads files as carefully as anything someone else wrote", () => {
    const doc = startingDoc("n1", 1, start);
    applyDoc(doc, { files: { good: { blob_id: "123", key: "a".repeat(44), type: "image/png", name: "x.png", size: 10 } as never } }, "local");
    doc.getMap("files").set("bad", { blob_id: "nope" });
    const files = readDoc(doc).files;
    expect(Object.keys(files)).toEqual(["good"]);
  });
});
