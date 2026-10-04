# libwebrtc's native code finds its Java classes, fields and methods by name
# (org.jni_zero is its JNI glue), so none of them may be renamed or removed.
# Classes of the app's own that implement its interfaces (the denoiser, the
# frame encryptors, the observers) keep those method names through them.
-keep class org.webrtc.** { *; }
-keep class org.jni_zero.** { *; }
-dontwarn org.webrtc.**
-dontwarn org.jni_zero.**
