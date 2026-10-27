package fish.nexa.data

/** Separate RNNoise instance per recording. Samples are mono PCM16 at 48 kHz, 480 per frame. */
internal object RecordingDsp {
    init { System.loadLibrary("nexa_native") }
    external fun create(): Long
    external fun process(ptr: Long, pcm: ShortArray, enhanced: Boolean)
    external fun destroy(ptr: Long)
}
