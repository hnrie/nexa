import { fitMedia, fitVideo } from "./fitMedia";

describe("fitMedia", () => {
  it("scales a picture down into the frame, keeping its shape", () => {
    expect(fitMedia(1920, 1080)).toEqual({ width: 550, height: 309 });
    expect(fitMedia(1080, 1920)).toEqual({ width: 197, height: 350 });
    expect(fitMedia(undefined, 10)).toEqual({ width: 400, height: 300 });
  });
});

describe("fitVideo", () => {
  it("keeps a landscape video's shape", () => {
    expect(fitVideo(1920, 1080)).toEqual({ width: 550, height: 309 });
  });

  it("gives a portrait video a frame no taller than the picture and wide enough for the controls", () => {
    expect(fitVideo(1080, 1920)).toEqual({ width: 320, height: 350 });
  });

  it("scales a small video up and never lets the frame get too short", () => {
    expect(fitVideo(160, 90)).toEqual({ width: 320, height: 180 });
    expect(fitVideo(3000, 100)).toEqual({ width: 550, height: 180 });
  });
});
