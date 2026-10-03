import { isGameWidget, isMusicWidget, musicLink, musicPicture, readWidgets, songLength, widgetsText, type MusicWidget } from "./widgets";

const art = "0b56f4eee05fa1ea753c5654b2cdb70c";

describe("music widgets", () => {
  it("reads what the server sent, leaving out what is malformed", () => {
    const got = readWidgets([
      { id: "w1", type: "songs", music: [{ id: "4091937401", name: "Bohemian Rhapsody", by: "Queen", art, duration: 354 }, { name: " " }, { id: "x", name: "Odd Id", art: "nothex", duration: -3 }] },
      { id: "w2", type: "artists", music: [{ id: "412", name: "Queen", by: "never for an artist", duration: 10 }] },
      { id: "w3", type: "albums", music: [] },
      { id: "w4", type: "albums", music: Array.from({ length: 20 }, (_, i) => ({ name: `Album ${i}` })) },
    ]);
    expect(got.map((w) => w.type)).toEqual(["songs", "artists", "albums"]);
    const songs = got[0] as MusicWidget;
    expect(songs.music).toEqual([
      { id: "4091937401", name: "Bohemian Rhapsody", by: "Queen", art, duration: 354 },
      { name: "Odd Id" },
    ]);
    expect((got[1] as MusicWidget).music).toEqual([{ id: "412", name: "Queen" }]);
    // no more than an album widget holds
    expect((got[2] as MusicWidget).music).toHaveLength(12);
    expect(isMusicWidget(got[0]!) && !isGameWidget(got[0]!)).toBe(true);
  });

  it("links what Deezer has to Deezer, and draws its picture from this server", () => {
    expect(musicLink("songs", { id: "4091937401", name: "Bohemian Rhapsody" })).toBe("https://www.deezer.com/track/4091937401");
    expect(musicLink("albums", { id: "1", name: "A" })).toBe("https://www.deezer.com/album/1");
    expect(musicLink("artists", { name: "My Band" })).toBeNull();
    // the small copy (120 pixels) while it is enough for this screen, the large one past that
    expect(musicPicture("songs", { name: "Bohemian Rhapsody", art }, 40)).toBe(`/media/music/cover/${art}?size=s`);
    expect(musicPicture("artists", { name: "Queen", art }, 200)).toBe(`/media/music/artist/${art}?size=l`);
    expect(musicPicture("albums", { name: "Ours", image: "123" }, 88)).toMatch(/^\/media\/widget\/123\?size=\d+$/);
    expect(musicPicture("albums", { name: "Nothing" }, 88)).toBeNull();
  });

  it("prints a song's length the way a sleeve does", () => {
    expect(songLength(354)).toBe("5:54");
    expect(songLength(65)).toBe("1:05");
    expect(songLength(3727)).toBe("1:02:07");
  });

  it("tells the staff what is on them", () => {
    const text = widgetsText(readWidgets([{ id: "w1", type: "albums", music: [{ name: "OK Computer", by: "Radiohead" }, { name: "Ours" }] }]), (w) => w.type);
    expect(text).toEqual([{ title: "albums", text: "OK Computer (Radiohead), Ours" }]);
  });
});
