/**
 * A video's sound, where a site keeps it in a file of its own.
 *
 * Reddit stores a video as two files, the picture and the sound, and plays
 * them together. A card for such a post carries both, and this keeps a
 * hidden audio element in step with the video: it starts, stops, seeks and
 * changes speed and volume when the video does, and is pulled back when the
 * two drift apart. If the sound cannot load, the video plays without it.
 */

/** How far apart the two may run before the sound is moved to the picture. */
const DRIFT = 0.25;

export function followVideo(video: HTMLVideoElement, audio: HTMLAudioElement): () => void {
  const align = () => {
    if (Math.abs(audio.currentTime - video.currentTime) > DRIFT) audio.currentTime = video.currentTime;
  };
  const settings = () => {
    audio.volume = video.volume;
    audio.muted = video.muted;
    audio.playbackRate = video.playbackRate;
  };
  const start = () => {
    if (video.paused || video.ended) return;
    settings();
    align();
    // refused (no sound allowed yet, the file gone): the picture plays on
    void audio.play().catch(() => {});
  };
  const stop = () => audio.pause();
  const seek = () => {
    audio.currentTime = video.currentTime;
  };
  const tick = () => {
    if (video.paused) return;
    if (audio.paused) start();
    else align();
  };
  settings();
  const on: [string, () => void][] = [
    ["play", start],
    ["playing", start],
    ["pause", stop],
    ["waiting", stop],
    ["ended", stop],
    ["seeking", seek],
    ["timeupdate", tick],
    ["ratechange", settings],
    ["volumechange", settings],
  ];
  for (const [name, fn] of on) video.addEventListener(name, fn);
  return () => {
    for (const [name, fn] of on) video.removeEventListener(name, fn);
    audio.pause();
  };
}
