package xyz.evilion.chat.crypto

import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** AES-256-GCM, the one shape of symmetric encryption this app uses. */
object Aes {
    const val IV_LEN = 12
    const val TAG_LEN = 16
    private const val TAG_BITS = TAG_LEN * 8

    fun encrypt(key: ByteArray, iv: ByteArray, plaintext: ByteArray, aad: ByteArray): ByteArray =
        cipher(Cipher.ENCRYPT_MODE, key, iv, aad).doFinal(plaintext)

    fun decrypt(key: ByteArray, iv: ByteArray, ciphertext: ByteArray, aad: ByteArray): ByteArray =
        try {
            cipher(Cipher.DECRYPT_MODE, key, iv, aad).doFinal(ciphertext)
        } catch (e: Exception) {
            throw DecryptError(e.message ?: "decryption failed")
        }

    /** Decrypts a slice in place-ish, without copying the input first. */
    fun decrypt(key: ByteArray, iv: ByteArray, ciphertext: ByteArray, offset: Int, length: Int, aad: ByteArray): ByteArray =
        try {
            cipher(Cipher.DECRYPT_MODE, key, iv, aad).doFinal(ciphertext, offset, length)
        } catch (e: Exception) {
            throw DecryptError(e.message ?: "decryption failed")
        }

    private fun cipher(mode: Int, key: ByteArray, iv: ByteArray, aad: ByteArray): Cipher {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, iv))
        if (aad.isNotEmpty()) c.updateAAD(aad)
        return c
    }
}
