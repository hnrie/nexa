# The advert's renderer

A Remotion project that draws Nexa's adverts (`tools/advert.py`). The cut
itself (which take is where, framed how, on which beat) is worked out by
`tools/advert_edit.py`, which measures the song and passes the cut here as
input props; `src/Advert.tsx` draws any moment of it with real motion blur
(`CameraMotionBlur`), and Remotion lays the song in on the same clock.

Run it through `tools/advert.py edit`, not on its own. To look around in
Remotion Studio with the last cut: `npx remotion studio --props=$ADVERT_WORK/props.json`
(while `advert.py` is not serving the frames, they will not load).
