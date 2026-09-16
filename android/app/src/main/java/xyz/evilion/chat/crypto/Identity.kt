package xyz.evilion.chat.crypto

import org.bouncycastle.math.ec.rfc7748.X25519

/**
 * Identity keys, private-key wrapping and sealed boxes, matching
 * web/src/crypto/keys.ts.
 *
 * An identity is a long-lived x25519 key pair. The private half is wrapped
 * with the password-derived encryption key before it is ever handed to the
 * server. Conversation root keys reach members as sealed boxes addressed to
 * their identity public key.
 */
data class Identity(val publicKey: ByteArray, val privateKey: ByteArray) {
    override fun equals(other: Any?): Boolean =
        other is Identity && publicKey.contentEquals(other.publicKey) && privateKey.contentEquals(other.privateKey)

    override fun hashCode(): Int = publicKey.contentHashCode() * 31 + privateKey.contentHashCode()
}

object Keys {
    private const val KEY_LEN = 32
    private val AAD_PRIVKEY = "privkey/v1".toByteArray()
    private val INFO_SEAL = "evilion-chat/seal/v1".toByteArray()

    fun generateIdentity(): Identity {
        val priv = Bytes.random(KEY_LEN)
        return Identity(publicKeyOf(priv), priv)
    }

    fun publicKeyOf(privateKey: ByteArray): ByteArray {
        val out = ByteArray(KEY_LEN)
        X25519.scalarMultBase(privateKey, 0, out, 0)
        return out
    }

    fun wrapPrivateKey(priv: ByteArray, encKey: ByteArray): ByteArray {
        val iv = Bytes.random(Aes.IV_LEN)
        return Bytes.concat(iv, Aes.encrypt(encKey, iv, priv, AAD_PRIVKEY))
    }

    fun unwrapPrivateKey(blob: ByteArray, encKey: ByteArray): ByteArray {
        if (blob.size < Aes.IV_LEN + Aes.TAG_LEN) throw DecryptError("wrapped private key is too short")
        return try {
            Aes.decrypt(encKey, blob.copyOf(Aes.IV_LEN), blob, Aes.IV_LEN, blob.size - Aes.IV_LEN, AAD_PRIVKEY)
        } catch (_: Exception) {
            throw DecryptError("wrapped private key failed to decrypt")
        }
    }

    private fun sealKey(ephPub: ByteArray, recipientPub: ByteArray, shared: ByteArray): ByteArray =
        Kdf.hkdf(shared, Bytes.concat(INFO_SEAL, ephPub, recipientPub))

    private fun sharedSecret(priv: ByteArray, pub: ByteArray): ByteArray {
        val out = ByteArray(KEY_LEN)
        // Rejects low-order points, which would otherwise agree on zero.
        if (!X25519.calculateAgreement(priv, 0, pub, 0, out, 0)) throw DecryptError("bad public key")
        return out
    }

    /**
     * Seals `data` to `recipientPub` with an ephemeral key.
     * Layout: ephemeral public key (32) | iv (12) | AES-256-GCM ciphertext and tag.
     */
    fun seal(recipientPub: ByteArray, data: ByteArray): ByteArray {
        val eph = generateIdentity()
        val key = sealKey(eph.publicKey, recipientPub, sharedSecret(eph.privateKey, recipientPub))
        val iv = Bytes.random(Aes.IV_LEN)
        return Bytes.concat(eph.publicKey, iv, Aes.encrypt(key, iv, data, eph.publicKey))
    }

    fun open(recipientPriv: ByteArray, recipientPub: ByteArray, blob: ByteArray): ByteArray {
        if (blob.size < KEY_LEN + Aes.IV_LEN + Aes.TAG_LEN) throw DecryptError("sealed box is too short")
        val ephPub = blob.copyOfRange(0, KEY_LEN)
        val iv = blob.copyOfRange(KEY_LEN, KEY_LEN + Aes.IV_LEN)
        return try {
            val key = sealKey(ephPub, recipientPub, sharedSecret(recipientPriv, ephPub))
            Aes.decrypt(key, iv, blob, KEY_LEN + Aes.IV_LEN, blob.size - KEY_LEN - Aes.IV_LEN, ephPub)
        } catch (_: Exception) {
            throw DecryptError("sealed box failed to decrypt")
        }
    }

    /** A conversation root key sealed to a member's identity key. */
    fun wrapGrant(recipientPub: ByteArray, root: ByteArray): ByteArray = seal(recipientPub, root)

    fun unwrapGrant(priv: ByteArray, pub: ByteArray, wrapped: ByteArray): ByteArray = open(priv, pub, wrapped)
}
