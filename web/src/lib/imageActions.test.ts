// @vitest-environment jsdom
import { imageNameFromUrl, imageTarget, setFullSource, withExtension } from "./imageActions";

describe("imageTarget", () => {
  it("finds the picture under the pointer, and nothing elsewhere", () => {
    document.body.innerHTML = `
      <div class="msg"><img id="pic" data-image-src="blob:x" data-image-name="cat.png"><span id="text">hi</span></div>
      <div data-image-src="/media/sticker/1"><span id="inner"></span></div>
      <img id="bare" src="/x.png">`;
    expect(imageTarget(document.getElementById("pic"))).toEqual({ src: "blob:x", name: "cat.png" });
    expect(imageTarget(document.getElementById("inner"))).toEqual({ src: "/media/sticker/1", name: "image" });
    expect(imageTarget(document.getElementById("text"))).toBeNull();
    expect(imageTarget(document.getElementById("bare"))).toBeNull();
    expect(imageTarget(null)).toBeNull();
  });
});

describe("pictures shown from their small copy", () => {
  it("copy and save the picture itself, not the copy", async () => {
    document.body.innerHTML = `<img id="copy" data-image-src="blob:copy" data-image-name="cat.jpg">`;
    const el = document.getElementById("copy")!;
    setFullSource(el, () => Promise.resolve("blob:full"));
    const target = imageTarget(el)!;
    expect(target.src).toBe("blob:copy");
    await expect(target.full!()).resolves.toBe("blob:full");
    // showing the picture itself again, it has nothing else to offer
    setFullSource(el, null);
    expect(imageTarget(el)).toEqual({ src: "blob:copy", name: "cat.jpg" });
  });
});

describe("file names", () => {
  it("adds the picture's own extension when the name has none", () => {
    expect(withExtension("Grumpy", "image/png")).toBe("Grumpy.png");
    expect(withExtension("Grumpy", "image/gif")).toBe("Grumpy.gif");
    expect(withExtension("photo.jpeg", "image/jpeg")).toBe("photo.jpeg");
    expect(withExtension("", "image/webp")).toBe("image.webp");
    expect(withExtension("thing", "application/octet-stream")).toBe("thing");
  });

  it("names a proxied picture after its original address", () => {
    const original = "https://cdn.example.com/art/sunset.jpg?w=400";
    const b64 = btoa(original).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(imageNameFromUrl(`/media/proxy/sig123/${b64}`)).toBe("sunset.jpg");
    expect(imageNameFromUrl("https://example.com/a/b/cat%20pic.png")).toBe("cat pic.png");
    expect(imageNameFromUrl("https://example.com/")).toBe("image");
    expect(imageNameFromUrl("/media/proxy/sig/!!!")).toBe("image");
  });
});
