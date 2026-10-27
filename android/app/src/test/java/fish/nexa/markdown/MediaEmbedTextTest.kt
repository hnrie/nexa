package fish.nexa.markdown

import fish.nexa.media.Unfurl
import fish.nexa.media.isOnlyMediaLinks
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MediaEmbedTextTest {
    @Test fun imagesAndGifsStandAlone() {
        val image = Unfurl("https://cdn.example/cat.png", "image")
        val gif = Unfurl("/media/proxy/signed/gif", "gif")
        assertTrue(isOnlyMediaLinks(image.url, listOf(image)))
        assertTrue(isOnlyMediaLinks("https://short.example/picture", listOf(image)))
        assertTrue(isOnlyMediaLinks(gif.url, listOf(gif)))
        assertFalse(isOnlyMediaLinks("look at ${image.url}", listOf(image)))
    }

    @Test fun audioAndVideoKeepTheirOriginalLinks() {
        val audio = Unfurl("https://cdn.example/track.mp3?token=original", "audio", media = "/media/proxy/signed/file", mediaKind = "audio")
        val video = Unfurl("https://cdn.example/clip.mp4", "video")
        assertFalse(isOnlyMediaLinks(audio.url, listOf(audio)))
        assertFalse(isOnlyMediaLinks(video.url, listOf(video)))
        assertFalse(isOnlyMediaLinks("https://short.example/movie", listOf(video)))
        assertFalse(isOnlyMediaLinks("${audio.url} ${video.url}", listOf(audio, video)))
    }
}
