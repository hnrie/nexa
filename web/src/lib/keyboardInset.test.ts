// @vitest-environment jsdom
import { coveredBottom, installKeyboardInset, isTypingField, keyboardHeight, revealField, snapToWord, tapField } from "./keyboardInset";

/** An iPhone's page: 714 tall, with a keyboard (and what Safari floats over it) that leaves 384. */
const LAYOUT = 714;
const ROOM = 384;

describe("what the viewport says about the keyboard", () => {
  it("measures the keyboard from the page's height and what is left in view", () => {
    expect(keyboardHeight({ layout: LAYOUT, visual: ROOM, offsetTop: 0, scale: 1 })).toBe(330);
    expect(keyboardHeight({ layout: LAYOUT, visual: LAYOUT, offsetTop: 0, scale: 1 })).toBe(0);
  });

  it("measures the same keyboard wherever Safari has slid the page", () => {
    expect(keyboardHeight({ layout: LAYOUT, visual: ROOM, offsetTop: 330, scale: 1 })).toBe(330);
    expect(keyboardHeight({ layout: LAYOUT, visual: ROOM, offsetTop: 160, scale: 1 })).toBe(330);
  });

  it("does not take a toolbar coming and going, or a pinched-in view, for a keyboard", () => {
    expect(keyboardHeight({ layout: LAYOUT, visual: LAYOUT - 80, offsetTop: 0, scale: 1 })).toBe(0);
    expect(keyboardHeight({ layout: LAYOUT, visual: 357, offsetTop: 100, scale: 2 })).toBe(0);
  });

  it("says how much of the page's bottom is covered where the page is now", () => {
    expect(coveredBottom({ layout: LAYOUT, visual: ROOM, offsetTop: 0, scale: 1 })).toBe(330);
    // slid all the way up, the bottom of the page is what is in view
    expect(coveredBottom({ layout: LAYOUT, visual: ROOM, offsetTop: 330, scale: 1 })).toBe(0);
    expect(coveredBottom({ layout: LAYOUT, visual: ROOM, offsetTop: 160, scale: 1 })).toBe(170);
    expect(coveredBottom({ layout: LAYOUT, visual: 357, offsetTop: 0, scale: 2 })).toBe(0);
  });
});

/** jsdom has no editing: an element is editable here because the test says so. */
function editable(...els: Element[]): void {
  for (const el of els) Object.defineProperty(el, "isContentEditable", { value: true, configurable: true });
}

describe("which things are typed in", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <textarea id="box"></textarea><textarea id="locked" readonly></textarea>
      <input id="name" /><input id="mail" type="email" /><input id="day" type="date" /><input id="tick" type="checkbox" /><input id="off" disabled />
      <div id="note"><p id="line">Meet at <b id="bold">nine</b>.</p><div id="file" contenteditable="false"><button id="open">Open</button></div><a id="link" href="/x">a link</a></div>
      <div id="plain">not editable</div>`;
    editable(...["note", "line", "bold", "link"].map((id) => document.getElementById(id)!));
  });

  it("knows a field that brings up a keyboard", () => {
    const yes = ["box", "name", "mail", "day", "note"];
    const no = ["locked", "tick", "off", "plain"];
    expect(yes.filter((id) => isTypingField(document.getElementById(id)))).toEqual(yes);
    expect(no.filter((id) => isTypingField(document.getElementById(id)))).toEqual([]);
    expect(isTypingField(null)).toBe(false);
  });

  it("stands in for a tap on a text box itself, and on the text of an editable area", () => {
    const at = (id: string) => tapField(document.getElementById(id))?.id ?? null;
    expect(at("box")).toBe("box");
    expect(at("name")).toBe("name");
    expect(at("mail")).toBe("mail");
    // the whole area takes the focus, wherever in its text the finger landed
    expect(at("note")).toBe("note");
    expect(at("line")).toBe("note");
    expect(at("bold")).toBe("note");
  });

  it("leaves to the browser a tap that is for something else", () => {
    const at = (id: string) => tapField(document.getElementById(id));
    // a picker rather than a caret, a box that cannot be typed in, a page that is not editable
    expect(at("day")).toBeNull();
    expect(at("locked")).toBeNull();
    expect(at("tick")).toBeNull();
    expect(at("plain")).toBeNull();
    // inside an editable area: a file's card and its button, a link
    expect(at("file")).toBeNull();
    expect(at("open")).toBeNull();
    expect(at("link")).toBeNull();
    expect(tapField(null)).toBeNull();
  });
});

describe("where a tap leaves the caret in a text box", () => {
  it("goes to the nearer end of the word tapped in, as the keyboard's own tap does", () => {
    const text = "meet at nine tonight";
    // "nine" runs from 8 to 12
    expect(snapToWord(text, 9)).toBe(8);
    expect(snapToWord(text, 10)).toBe(12);
    expect(snapToWord(text, 11)).toBe(12);
    // already at an end, or between words: where it is
    expect(snapToWord(text, 8)).toBe(8);
    expect(snapToWord(text, 12)).toBe(12);
    expect(snapToWord("two  spaces", 4)).toBe(4);
  });

  it("stays inside the text and on the line", () => {
    expect(snapToWord("", 0)).toBe(0);
    expect(snapToWord("word", 1)).toBe(0);
    expect(snapToWord("word", 3)).toBe(4);
    // a line break ends a word as a space does
    expect(snapToWord("one\ntwo", 5)).toBe(4);
    expect(snapToWord("one\ntwo", 2)).toBe(3);
  });
});

/** A list `height` tall at the top of the page with `content` in it, and a field `fieldHeight` tall at `at` in that content. */
function listWithField(height: number, content: number, at: number, fieldHeight = 40): { box: HTMLElement; field: HTMLElement } {
  document.body.innerHTML = `<div id="box" style="overflow-y: auto"><input id="field" /></div>`;
  const box = document.getElementById("box")!;
  const field = document.getElementById("field")!;
  Object.defineProperty(box, "clientHeight", { value: height });
  Object.defineProperty(box, "scrollHeight", { value: content });
  box.getBoundingClientRect = () => ({ top: 0, bottom: height, left: 0, right: 300, width: 300, height }) as DOMRect;
  field.getBoundingClientRect = () => ({ top: at - box.scrollTop, bottom: at - box.scrollTop + fieldHeight, left: 0, right: 300, width: 300, height: fieldHeight }) as DOMRect;
  return { box, field };
}

describe("bringing a field into view", () => {
  it("scrolls its list just far enough to clear the keyboard", () => {
    const { box, field } = listWithField(LAYOUT, 2000, 600);
    revealField(field, ROOM);
    // its bottom edge a margin above where the keyboard starts
    expect(field.getBoundingClientRect().bottom).toBe(ROOM - 12);
    expect(box.scrollTop).toBe(600 + 40 - (ROOM - 12));
  });

  it("leaves alone a field already in view, and brings back one above the top", () => {
    const seen = listWithField(ROOM, 2000, 200);
    revealField(seen.field, ROOM);
    expect(seen.box.scrollTop).toBe(0);
    const above = listWithField(ROOM, 2000, 100);
    above.box.scrollTop = 400;
    revealField(above.field, ROOM);
    expect(above.field.getBoundingClientRect().top).toBe(12);
  });

  it("puts a field that takes focus under an open keyboard in the upper half, where Safari wants it", () => {
    const { field } = listWithField(ROOM, 2000, 300);
    revealField(field, ROOM, true);
    const r = field.getBoundingClientRect();
    expect(r.top + r.height / 2).toBeLessThanOrEqual(ROOM / 2);
    // one already there is not moved
    const high = listWithField(ROOM, 2000, 60);
    revealField(high.field, ROOM, true);
    expect(high.box.scrollTop).toBe(0);
  });
});

/** The visual viewport, which jsdom does not have. */
class FakeViewport extends EventTarget {
  height = LAYOUT;
  offsetTop = 0;
  pageTop = 0;
  scale = 1;
}

describe("fitting the app above the keyboard", () => {
  let vv: FakeViewport;
  let uninstall: () => void;
  let scrollY: number;
  let scrollTo: ReturnType<typeof vi.fn>;
  let box: HTMLTextAreaElement;
  const root = document.documentElement;
  const css = (name: string) => root.style.getPropertyValue(name);

  /** One frame, in which what the viewport said is taken in. */
  const frame = () => vi.advanceTimersByTime(20);
  /** The keyboard comes up (or goes, at the page's full height), as the viewport reports it. */
  const keyboard = (room: number) => {
    vv.height = room;
    vv.dispatchEvent(new Event("resize"));
    frame();
  };
  /** Safari slides the page up by `by`, the way it does to centre a field. */
  const slide = (by: number) => {
    scrollY = by;
    vv.offsetTop = by;
    vv.pageTop = by;
    window.dispatchEvent(new Event("scroll"));
    vv.dispatchEvent(new Event("scroll"));
  };
  const touch = (type: string, target: EventTarget, x = 10, y = 10): Event => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, "touches", { value: type === "touchend" ? [] : [{ clientX: x, clientY: y }] });
    Object.defineProperty(e, "changedTouches", { value: [{ clientX: x, clientY: y }] });
    target.dispatchEvent(e);
    return e;
  };
  /** A finger tapping a field, with the focus the browser gives it. */
  const tap = (el: HTMLElement) => {
    touch("touchstart", el);
    touch("touchend", el);
    el.focus();
  };
  const install = (ios = false) => {
    uninstall = installKeyboardInset(ios);
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
    localStorage.clear();
    document.body.innerHTML = `<div id="app" data-keyboard-fit=""><textarea id="box">draft</textarea><input id="other" /><button id="send">Send</button></div>`;
    box = document.getElementById("box") as HTMLTextAreaElement;
    vv = new FakeViewport();
    scrollY = 0;
    scrollTo = vi.fn((_x: number, y: number) => {
      scrollY = y;
      vv.offsetTop = y;
      vv.pageTop = y;
    });
    vi.stubGlobal("visualViewport", vv);
    vi.stubGlobal("scrollTo", scrollTo);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
    Object.defineProperty(root, "clientHeight", { configurable: true, get: () => LAYOUT });
    Object.defineProperty(root, "clientWidth", { configurable: true, get: () => 402 });
    uninstall = () => undefined;
  });

  afterEach(() => {
    uninstall();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("gives the app the height the keyboard leaves, and says how much is covered", () => {
    install();
    expect(css("--kb-inset")).toBe("0px");
    box.focus();
    keyboard(ROOM);
    expect(root.hasAttribute("data-keyboard")).toBe(true);
    expect(css("--app-h")).toBe("384px");
    expect(css("--vvh")).toBe("384px");
    expect(css("--kb-inset")).toBe("330px");
  });

  it("stays fitted when Safari gives the window's height as what is left above the keyboard", () => {
    install();
    box.focus();
    keyboard(ROOM);
    // What Safari does once the page is back at the top with a keyboard up.
    // Read as the page's height it said "no keyboard", and the app went back
    // to its full height with its bottom, message box and all, behind the keys.
    vi.stubGlobal("innerHeight", ROOM);
    vv.dispatchEvent(new Event("scroll"));
    frame();
    expect(root.hasAttribute("data-keyboard")).toBe(true);
    expect(css("--app-h")).toBe("384px");
  });

  it("puts the page back when Safari slides it up to centre the field", () => {
    install();
    box.focus();
    keyboard(ROOM);
    slide(160);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(scrollY).toBe(0);
  });

  it("goes to where the screen is when Safari will not let the page be put back", () => {
    install();
    box.focus();
    keyboard(ROOM);
    vi.advanceTimersByTime(400);
    // Safari 26 between two fields: it takes the scroll, the page believes itself back, and the screen stays where it was
    scrollTo.mockImplementation(() => {
      scrollY = 0;
    });
    slide(60);
    expect(root.hasAttribute("data-keyboard-slid")).toBe(false);
    // only once it has stopped moving is where it says it is believed
    vi.advanceTimersByTime(400);
    expect(root.hasAttribute("data-keyboard-slid")).toBe(true);
    expect(css("--vv-top")).toBe("60px");
    // the keyboard goes, the page can be put back again, and is
    scrollTo.mockImplementation(() => {
      scrollY = 0;
      vv.offsetTop = 0;
      vv.pageTop = 0;
    });
    box.blur();
    vi.advanceTimersByTime(60);
    expect(root.hasAttribute("data-keyboard-slid")).toBe(true);
    keyboard(LAYOUT);
    expect(root.hasAttribute("data-keyboard-slid")).toBe(false);
    expect(css("--vv-top")).toBe("");
  });

  it("slides the page itself to a field the fitting does not reach, once things have come to rest", () => {
    install();
    // something laid over the app, full height, with its field down where the keyboard is
    box.getBoundingClientRect = () => ({ top: 600 - scrollY, bottom: 640 - scrollY, left: 0, right: 300, width: 300, height: 40 }) as DOMRect;
    box.focus();
    keyboard(ROOM);
    expect(scrollTo).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    // as far as the keyboard is tall, which is as far as the page goes
    expect(scrollTo).toHaveBeenLastCalledWith(0, 330);
    expect(scrollY).toBe(330);
    // and it is kept there, not put back to the top
    slide(200);
    expect(scrollTo).toHaveBeenLastCalledWith(0, 330);
    // nothing is moved after it either
    vi.advanceTimersByTime(800);
    expect(root.hasAttribute("data-keyboard-slid")).toBe(false);
  });

  it("puts a field that is only a little too low in the middle of what is left", () => {
    install();
    box.getBoundingClientRect = () => ({ top: 400 - scrollY, bottom: 440 - scrollY, left: 0, right: 300, width: 300, height: 40 }) as DOMRect;
    box.focus();
    keyboard(ROOM);
    vi.advanceTimersByTime(400);
    // its middle (420) at the middle of the room (192)
    expect(scrollTo).toHaveBeenLastCalledWith(0, 228);
  });

  it("does not slide the page for a field that is in view down to its last hair", () => {
    install();
    // right against the keyboard, and a fraction of a pixel under it
    box.getBoundingClientRect = () => ({ top: 344.6 - scrollY, bottom: 384.6 - scrollY, left: 0, right: 300, width: 300, height: 40 }) as DOMRect;
    box.focus();
    keyboard(ROOM);
    vi.advanceTimersByTime(400);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("brings the page back to the top when focus goes on to a field the fitting does reach", () => {
    install();
    box.getBoundingClientRect = () => ({ top: 600 - scrollY, bottom: 640 - scrollY, left: 0, right: 300, width: 300, height: 40 }) as DOMRect;
    box.focus();
    keyboard(ROOM);
    vi.advanceTimersByTime(400);
    expect(scrollY).toBe(330);
    const other = document.getElementById("other")!;
    other.getBoundingClientRect = () => ({ top: 100 - scrollY, bottom: 140 - scrollY, left: 0, right: 300, width: 300, height: 40 }) as DOMRect;
    other.focus();
    vi.advanceTimersByTime(400);
    expect(scrollY).toBe(0);
  });

  it("does not move a view that is pinched in, and keeps the fit it had", () => {
    install();
    box.focus();
    keyboard(ROOM);
    // pinched in to twice the size, and dragged about
    vv.scale = 2;
    vv.height = ROOM / 2;
    slide(120);
    vv.dispatchEvent(new Event("resize"));
    frame();
    vi.advanceTimersByTime(800);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(root.hasAttribute("data-keyboard-slid")).toBe(false);
    expect(root.hasAttribute("data-keyboard")).toBe(true);
    expect(css("--app-h")).toBe("384px");
  });

  it("does not take a keyboard it cannot see, the view being pinched in, for one that never came", () => {
    localStorage.setItem("ec:keyboard", JSON.stringify({ heights: { "402": 330 } }));
    install();
    tap(box);
    expect(css("--app-h")).toBe("384px");
    // Safari pinches in by itself on a field set in small type
    vv.scale = 1.23;
    vv.height = 312;
    vv.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(2100);
    expect(root.hasAttribute("data-keyboard")).toBe(true);
    expect(JSON.parse(localStorage.getItem("ec:keyboard")!)).toMatchObject({ heights: { "402": 330 } });
  });

  it("lets go as soon as nothing is being typed in, without waiting for the keyboard to finish leaving", () => {
    install();
    box.focus();
    keyboard(ROOM);
    box.blur();
    vi.advanceTimersByTime(60);
    // the viewport still says 384: the keyboard is on its way out
    expect(root.hasAttribute("data-keyboard")).toBe(false);
    expect(css("--app-h")).toBe("");
    expect(css("--kb-inset")).toBe("0px");
    expect(css("--vvh")).toBe("714px");
  });

  it("keeps the fit while focus goes from one field to another", () => {
    install();
    box.focus();
    keyboard(ROOM);
    document.getElementById("other")!.focus();
    vi.advanceTimersByTime(60);
    expect(root.hasAttribute("data-keyboard")).toBe(true);
  });

  it("makes room at once for a tapped field, the keyboard being as tall as the last one", () => {
    install();
    tap(box);
    keyboard(ROOM);
    box.blur();
    vi.advanceTimersByTime(60);
    keyboard(LAYOUT);
    vi.advanceTimersByTime(1000);
    expect(root.hasAttribute("data-keyboard")).toBe(false);

    tap(box);
    // nothing from the viewport yet
    expect(root.hasAttribute("data-keyboard")).toBe(true);
    expect(css("--app-h")).toBe("384px");
    expect(root.hasAttribute("data-keyboard-moving")).toBe(true);
    // and it is remembered for the next time the app is opened
    expect(JSON.parse(localStorage.getItem("ec:keyboard")!)).toEqual({ heights: { "402": 330 }, slides: false });
  });

  it("gives the room back when the keyboard it expected never comes", () => {
    localStorage.setItem("ec:keyboard", JSON.stringify({ heights: { "402": 330 } }));
    install();
    tap(box);
    expect(css("--app-h")).toBe("384px");
    // real keys are attached: nothing comes up
    vi.advanceTimersByTime(2100);
    expect(root.hasAttribute("data-keyboard")).toBe(false);
    box.blur();
    vi.advanceTimersByTime(60);
    tap(box);
    expect(root.hasAttribute("data-keyboard")).toBe(false);
  });

  it("does not make room for a field that script focused long after any tap", () => {
    localStorage.setItem("ec:keyboard", JSON.stringify({ heights: { "402": 330 } }));
    install();
    touch("touchend", document.body);
    vi.advanceTimersByTime(1000);
    box.focus();
    expect(root.hasAttribute("data-keyboard")).toBe(false);
  });

  it("leaves a page that scrolls to the browser, measuring only", () => {
    document.getElementById("app")!.removeAttribute("data-keyboard-fit");
    install();
    box.focus();
    keyboard(ROOM);
    expect(root.hasAttribute("data-keyboard")).toBe(false);
    expect(css("--kb-inset")).toBe("330px");
    slide(330);
    frame();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(css("--kb-inset")).toBe("0px");
  });

  it("leaves a phone lying down to the browser too: the strip above its keyboard fits nothing", () => {
    Object.defineProperty(root, "clientHeight", { configurable: true, get: () => 338 });
    Object.defineProperty(root, "clientWidth", { configurable: true, get: () => 874 });
    // what reaches the browser's own focus, under the wrapping
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    localStorage.setItem("ec:keyboard", JSON.stringify({ heights: {}, slides: true }));
    install(true);
    // not taken over, and not told to keep still: Safari is to slide the page to the field
    touch("touchstart", box);
    expect(touch("touchend", box).defaultPrevented).toBe(false);
    box.focus();
    expect(focus.mock.calls.at(-1)).toEqual([undefined]);
    keyboard(46);
    expect(root.hasAttribute("data-keyboard")).toBe(false);
    slide(292);
    frame();
    expect(scrollTo).not.toHaveBeenCalled();
    uninstall();
    uninstall = () => undefined;
    focus.mockRestore();
  });

  it("does nothing where the browser makes the page shorter itself", () => {
    install();
    box.focus();
    // Android: the page and what is in view shrink together
    Object.defineProperty(root, "clientHeight", { configurable: true, get: () => 400 });
    keyboard(400);
    expect(root.hasAttribute("data-keyboard")).toBe(false);
    expect(css("--kb-inset")).toBe("0px");
    expect(css("--vvh")).toBe("400px");
  });

  it("takes everything back when uninstalled", () => {
    const focus = HTMLElement.prototype.focus;
    install(true);
    expect(HTMLElement.prototype.focus).not.toBe(focus);
    box.focus();
    keyboard(ROOM);
    uninstall();
    expect(HTMLElement.prototype.focus).toBe(focus);
    expect(root.hasAttribute("data-keyboard")).toBe(false);
    expect(root.getAttribute("style") ?? "").toBe("");
  });

  describe("on an iPhone", () => {
    let focused: Array<FocusOptions | undefined>;
    beforeEach(() => {
      focused = [];
      const focus = HTMLElement.prototype.focus;
      vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
        if (this === box) focused.push(options);
        focus.call(this, options);
      });
    });
    afterEach(() => {
      uninstall();
      uninstall = () => undefined;
      vi.restoreAllMocks();
    });

    it("has every focus made by script ask Safari not to slide the page", () => {
      install(true);
      box.focus();
      expect(focused).toEqual([{ preventScroll: true }]);
      // what a caller said is left as said, and so is anything not typed in
      box.blur();
      box.focus({ preventScroll: false });
      expect(focused[1]).toEqual({ preventScroll: false });
      const send = document.getElementById("send")!;
      const before = focused.length;
      send.focus();
      expect(focused).toHaveLength(before);
    });

    it("says a tap's focus again with preventScroll once the tap has placed the caret", () => {
      install(true);
      box.focus();
      focused.length = 0;
      box.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      box.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(focused).toEqual([{ preventScroll: true }, { preventScroll: true }]);
      // and only for the tap that focused it
      vi.advanceTimersByTime(10);
      box.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(focused).toHaveLength(2);
    });

    it("notes that Safari slid the page for a tapped field all the same", () => {
      install(true);
      tap(box);
      keyboard(ROOM);
      slide(330);
      expect(JSON.parse(localStorage.getItem("ec:keyboard")!)).toMatchObject({ slides: true });
    });

    it("does not conclude that from a slide when focus moves between two fields", () => {
      install(true);
      tap(box);
      keyboard(ROOM);
      tap(document.getElementById("other")!);
      slide(60);
      expect(JSON.parse(localStorage.getItem("ec:keyboard")!)).toMatchObject({ slides: false });
    });

    it("takes the tap itself where Safari slides the page for a tap's own focus", () => {
      localStorage.setItem("ec:keyboard", JSON.stringify({ heights: {}, slides: true }));
      install(true);
      const sent: string[] = [];
      for (const type of ["mousedown", "mouseup", "click"]) document.addEventListener(type, (e) => sent.push(`${type} ${(e as MouseEvent).clientX},${(e as MouseEvent).clientY}`), { once: true });
      touch("touchstart", box, 40, 50);
      const lift = touch("touchend", box, 40, 50);
      // no tap is left for the browser, the field has the focus and the caret, and a press was heard by whatever listens for one
      expect(lift.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(box);
      expect(focused).toEqual([{ preventScroll: true }]);
      // nothing is laid out here, so where the finger fell cannot be found: the end it is
      expect([box.selectionStart, box.selectionEnd]).toEqual([5, 5]);
      expect(sent).toEqual(["mousedown 40,50", "mouseup 40,50", "click 40,50"]);
    });

    it("leaves a tap alone that is a drag, a long press, on the field already typed in, or on anything else", () => {
      localStorage.setItem("ec:keyboard", JSON.stringify({ heights: {}, slides: true }));
      install(true);
      touch("touchstart", box, 40, 50);
      expect(touch("touchend", box, 40, 90).defaultPrevented).toBe(false);
      touch("touchstart", box);
      vi.advanceTimersByTime(600);
      expect(touch("touchend", box).defaultPrevented).toBe(false);
      const send = document.getElementById("send")!;
      touch("touchstart", send);
      expect(touch("touchend", send).defaultPrevented).toBe(false);
      box.focus();
      touch("touchstart", box);
      expect(touch("touchend", box).defaultPrevented).toBe(false);
    });

    it("does not take taps where Safari has not been seen to slide the page, nor on a page it is not fitting", () => {
      install(true);
      touch("touchstart", box);
      expect(touch("touchend", box).defaultPrevented).toBe(false);
      uninstall();
      localStorage.setItem("ec:keyboard", JSON.stringify({ heights: {}, slides: true }));
      document.getElementById("app")!.removeAttribute("data-keyboard-fit");
      install(true);
      touch("touchstart", box);
      expect(touch("touchend", box).defaultPrevented).toBe(false);
    });

    it("lets a press that something cancelled keep the field from taking focus", () => {
      localStorage.setItem("ec:keyboard", JSON.stringify({ heights: {}, slides: true }));
      install(true);
      box.addEventListener("mousedown", (e) => e.preventDefault(), { once: true });
      touch("touchstart", box);
      touch("touchend", box);
      expect(document.activeElement).not.toBe(box);
    });
  });
});
