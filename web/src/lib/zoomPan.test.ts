import { MAX_ZOOM, clampView, containedSize, pinchView } from "./zoomPan";

const box = { width: 400, height: 300 };

describe("zooming into a stream", () => {
  it("never zooms out past the whole picture, nor in past the limit", () => {
    expect(clampView({ scale: 0.5, x: 30, y: 30 }, box)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(clampView({ scale: 99, x: 0, y: 0 }, box).scale).toBe(MAX_ZOOM);
  });

  it("keeps the picture covering the box when panned", () => {
    // at 2x the picture is 800 x 600, so it can move 200 and 150 from the middle
    expect(clampView({ scale: 2, x: 500, y: -500 }, box)).toEqual({ scale: 2, x: 200, y: -150 });
  });

  it("keeps the point between the fingers under the fingers", () => {
    // pinching to 2x around a point 100 px right of the middle
    const v = pinchView({ scale: 1, x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }, 2, box);
    expect(v.scale).toBe(2);
    // that point was at 100 in the picture; at 2x it would sit at 200, so the picture moves back by 100
    expect(v.x).toBe(-100);
    expect(v.y).toBe(0);
  });

  it("pans with the fingers as they move", () => {
    const v = pinchView({ scale: 2, x: 0, y: 0 }, { x: 0, y: 0 }, { x: 40, y: -20 }, 1, box);
    expect(v).toEqual({ scale: 2, x: 40, y: -20 });
  });
});

describe("zooming into a picture that does not fill its box", () => {
  // a tall picture in a wide box: 150 x 300 drawn in the middle of 400 x 300
  const tall = { width: 150, height: 300 };

  it("keeps it in the middle while it is still narrower than the box", () => {
    // at 2x it is 300 wide, still inside 400: no moving sideways
    expect(clampView({ scale: 2, x: 120, y: 0 }, box, tall)).toEqual({ scale: 2, x: 0, y: 0 });
  });

  it("lets it move only as far as its edges reach the box's", () => {
    // at 4x it is 600 x 1200: 100 either way across, 450 up and down
    expect(clampView({ scale: 4, x: 500, y: -900 }, box, tall)).toEqual({ scale: 4, x: 100, y: -450 });
  });

  it("zooms around the pointer and stays in bounds", () => {
    const v = pinchView({ scale: 1, x: 0, y: 0 }, { x: 60, y: 100 }, { x: 60, y: 100 }, 3, box, tall);
    expect(v.scale).toBe(3);
    // 450 wide now: it may be 25 off the middle at most, and 300 up or down
    expect(v.x).toBe(-25);
    expect(v.y).toBe(-200);
  });

  it("works out how big a picture is drawn in its box", () => {
    expect(containedSize({ width: 1000, height: 2000 }, box)).toEqual({ width: 150, height: 300 });
    // never larger than it is, unless it may grow to the box
    expect(containedSize({ width: 100, height: 50 }, box)).toEqual({ width: 100, height: 50 });
    expect(containedSize({ width: 100, height: 50 }, box, true)).toEqual({ width: 400, height: 200 });
  });
});
