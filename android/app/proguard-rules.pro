# What R8 must leave alone in a release build.

# The native library finds these by their JNI names, which renaming would break.
-keep class xyz.evilion.chat.voice.FrameCryptoNative { *; }

# WebRTC's Java classes are reached from its own native code both ways.
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**

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
