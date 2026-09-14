import { MAX_ZOOM, clampView, pinchView } from "./zoomPan";

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
