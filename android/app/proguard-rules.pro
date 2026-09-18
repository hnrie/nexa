# What R8 must leave alone in a release build.

# The native library finds these by their JNI names, which renaming would break.
-keep class xyz.evilion.chat.voice.FrameCryptoNative { *; }

# WebRTC's Java classes are reached from its own native code both ways.
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**

# And the layer it registers that JNI through. Nothing in Java names
# org.jni_zero — only WebRTC's native library does, by string — so R8 saw dead
# code and removed it. The release build then aborted the whole process the
# moment a call started:
#
#   ClassNotFoundException: org.jni_zero.JniZero
#     at org.webrtc.NativeLibrary$DefaultLoader.load
#     at org.webrtc.PeerConnectionFactory.initialize
#   JNI DETECTED ERROR IN APPLICATION: java_class == null in GetStaticMethodID
#
# Debug builds were fine, because nothing is shrunk there, which is exactly
# why this shipped.
-keep class org.jni_zero.** { *; }
-keepclasseswithmembers class * { @org.jni_zero.* <methods>; }
-keepclasseswithmembers class * { @org.jni_zero.* <fields>; }
-dontwarn org.jni_zero.**

# argon2kt loads its own native library and calls back into these.
-keep class com.lambdapioneer.argon2kt.** { *; }

# kotlinx.serialization keeps generated serializers on the classes themselves.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class xyz.evilion.chat.**$$serializer { *; }
-keepclassmembers class xyz.evilion.chat.** { *** Companion; }
-keepclasseswithmembers class xyz.evilion.chat.** { kotlinx.serialization.KSerializer serializer(...); }

# BouncyCastle brings providers it looks up by name; the parts this app does
# not touch are shrunk away, and the warnings are about those.
-dontwarn org.bouncycastle.**
-keep class org.bouncycastle.math.ec.rfc7748.** { *; }

# OkHttp and Okio name platform classes that are not on Android.
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-dontwarn org.openjsse.**

# Compose keeps its own rules; this only silences the desugaring notes.
-dontwarn java.lang.invoke.**
