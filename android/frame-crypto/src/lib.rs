//! Narrow native bridge to RustCrypto AES-GCM. No hand-written AES/GHASH.
//! Call frames use a 32-byte key, a 12-byte nonce and a full 16-byte tag.
use aes_gcm::{aead::AeadInOut, Aes256Gcm, KeyInit, Nonce, Tag};
use std::{ptr, slice};
const MAX_FRAME: usize = 16 * 1024 * 1024;

// SAFETY: The C++ caller owns the buffers for the duration of each call. Empty
// vectors may supply null; Rust slices may not, even for a zero length.
unsafe fn bytes<'a>(p: *const u8, len: usize) -> Option<&'a [u8]> {
    if len == 0 {
        Some(&[])
    } else if p.is_null() || len > MAX_FRAME {
        None
    } else {
        Some(slice::from_raw_parts(p, len))
    }
}

/// SAFETY: key points to exactly 32 readable bytes. The returned handle must
/// be freed once, after all operations using it have ended.
#[no_mangle]
pub unsafe extern "C" fn nexa_aead_new(key: *const u8) -> *mut Aes256Gcm {
    if key.is_null() {
        return ptr::null_mut();
    }
    match Aes256Gcm::new_from_slice(slice::from_raw_parts(key, 32)) {
        Ok(cipher) => Box::into_raw(Box::new(cipher)),
        Err(_) => ptr::null_mut(),
    }
}

/// SAFETY: handle is null or a live pointer returned by nexa_aead_new.
#[no_mangle]
pub unsafe extern "C" fn nexa_aead_free(handle: *mut Aes256Gcm) {
    if !handle.is_null() {
        drop(Box::from_raw(handle));
    }
}

/// SAFETY: all nonempty inputs are readable; output has len + 16 writable
/// bytes. Input and output may alias. The handle remains alive throughout.
#[no_mangle]
pub unsafe extern "C" fn nexa_aead_seal(
    handle: *const Aes256Gcm,
    iv: *const u8,
    iv_len: usize,
    aad: *const u8,
    aad_len: usize,
    input: *const u8,
    len: usize,
    output: *mut u8,
) -> bool {
    if handle.is_null() || iv.is_null() || iv_len != 12 || output.is_null() || len > MAX_FRAME {
        return false;
    }
    let Some(aad) = bytes(aad, aad_len) else {
        return false;
    };
    if len > 0 {
        if input.is_null() {
            return false;
        }
        ptr::copy(input, output, len);
    }
    let nonce = Nonce::try_from(slice::from_raw_parts(iv, 12)).unwrap();
    let buffer = slice::from_raw_parts_mut(output, len);
    match (*handle).encrypt_inout_detached(&nonce, aad, buffer.into()) {
        Ok(tag) => {
            ptr::copy_nonoverlapping(tag.as_ptr(), output.add(len), 16);
            true
        }
        Err(_) => false,
    }
}

/// SAFETY: input holds len bytes including the tag; output has len - 16
/// writable bytes (non-null even when empty). Input and output may alias.
#[no_mangle]
pub unsafe extern "C" fn nexa_aead_open(
    handle: *const Aes256Gcm,
    iv: *const u8,
    iv_len: usize,
    aad: *const u8,
    aad_len: usize,
    input: *const u8,
    len: usize,
    output: *mut u8,
) -> bool {
    if handle.is_null()
        || iv.is_null()
        || iv_len != 12
        || input.is_null()
        || output.is_null()
        || len < 16
        || len > MAX_FRAME + 16
    {
        return false;
    }
    let Some(aad) = bytes(aad, aad_len) else {
        return false;
    };
    let nonce = Nonce::try_from(slice::from_raw_parts(iv, 12)).unwrap();
    let plain_len = len - 16;
    let tag = Tag::try_from(slice::from_raw_parts(input.add(plain_len), 16)).unwrap();
    ptr::copy(input, output, plain_len);
    let buffer = slice::from_raw_parts_mut(output, plain_len);
    if (*handle)
        .decrypt_inout_detached(&nonce, aad, buffer.into(), &tag)
        .is_err()
    {
        slice::from_raw_parts_mut(output, plain_len).fill(0);
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nist_aes256_and_tampering() {
        unsafe {
            let key = [0u8; 32];
            let iv = [0u8; 12];
            let plain = [0u8; 16];
            let cipher = nexa_aead_new(key.as_ptr());
            let mut out = [0u8; 32];
            assert!(nexa_aead_seal(
                cipher,
                iv.as_ptr(),
                12,
                ptr::null(),
                0,
                plain.as_ptr(),
                plain.len(),
                out.as_mut_ptr()
            ));
            let hex: String = out.iter().map(|x| format!("{x:02x}")).collect();
            assert_eq!(
                hex,
                "cea7403d4d606b6e074ec5d3baf39d18d0d1c8a799996bf0265b98b5d48ab919"
            );
            let mut opened = [42u8; 16];
            assert!(nexa_aead_open(
                cipher,
                iv.as_ptr(),
                12,
                ptr::null(),
                0,
                out.as_ptr(),
                out.len(),
                opened.as_mut_ptr()
            ));
            assert_eq!(opened, plain);
            out[31] ^= 1;
            assert!(!nexa_aead_open(
                cipher,
                iv.as_ptr(),
                12,
                ptr::null(),
                0,
                out.as_ptr(),
                out.len(),
                opened.as_mut_ptr()
            ));
            assert_eq!(opened, [0u8; 16]);
            nexa_aead_free(cipher);
        }
    }
    #[test]
    fn empty_frames_and_in_place_buffers() {
        unsafe {
            let key = [9u8; 32];
            let iv = [3u8; 12];
            let aad = [1, 2, 3];
            let cipher = nexa_aead_new(key.as_ptr());
            let mut data = [0u8; 16];
            assert!(nexa_aead_seal(
                cipher,
                iv.as_ptr(),
                12,
                aad.as_ptr(),
                3,
                ptr::null(),
                0,
                data.as_mut_ptr()
            ));
            assert!(nexa_aead_open(
                cipher,
                iv.as_ptr(),
                12,
                aad.as_ptr(),
                3,
                data.as_ptr(),
                16,
                data.as_mut_ptr()
            ));
            let mut data = [0u8; 32];
            data[..16].fill(7);
            assert!(nexa_aead_seal(
                cipher,
                iv.as_ptr(),
                12,
                aad.as_ptr(),
                3,
                data.as_ptr(),
                16,
                data.as_mut_ptr()
            ));
            assert!(nexa_aead_open(
                cipher,
                iv.as_ptr(),
                12,
                aad.as_ptr(),
                3,
                data.as_ptr(),
                32,
                data.as_mut_ptr()
            ));
            assert_eq!(&data[..16], &[7u8; 16]);
            assert!(!nexa_aead_seal(
                cipher,
                iv.as_ptr(),
                8,
                ptr::null(),
                0,
                ptr::null(),
                0,
                data.as_mut_ptr()
            ));
            nexa_aead_free(cipher);
        }
    }
}
