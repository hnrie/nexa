package fish.nexa

import fish.nexa.crypto.Bytes
import fish.nexa.crypto.DecryptError
import fish.nexa.crypto.FileCrypto
import java.io.ByteArrayOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class FileCompletenessTest {
    @Test fun aWholeAuthenticatedChunkDoesNotProveTheFileIsComplete() {
        val plain = ByteArray(FileCrypto.CHUNK + 1)
        val key = Bytes.random(32)
        val encrypted = FileCrypto.encryptBytes(plain, key)
        val prefix = encrypted.copyOf(FileCrypto.encryptedSize(FileCrypto.CHUNK.toLong()).toInt())
        assertThrows(DecryptError::class.java) {
            FileCrypto.decryptStream(prefix.inputStream(), key, ByteArrayOutputStream(), expectedSize = plain.size.toLong())
        }
        val out = ByteArrayOutputStream()
        assertEquals(plain.size.toLong(), FileCrypto.decryptStream(encrypted.inputStream(), key, out, expectedSize = plain.size.toLong()))
    }
}
