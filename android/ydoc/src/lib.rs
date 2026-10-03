//! A note as the web client keeps it (web/src/lib/notes/ydoc.ts): one Yjs
//! document with two texts, "title" and "md", and a map of files, "files".
//! Updates are Yjs's version 1 encoding, so a phone and a browser editing the
//! same note exchange the very same bytes. Positions count UTF-16 code units,
//! as JavaScript strings do.
use jni::objects::{JByteArray, JClass, JObjectArray, JString};
use jni::sys::{jboolean, jbyteArray, jint, jlong, jstring, JNI_FALSE, JNI_TRUE};
use jni::JNIEnv;
use std::sync::Mutex;
use yrs::types::ToJson;
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::block::ClientID;
use yrs::{Any, Doc, GetString, Map, MapRef, Number, OffsetKind, Options, ReadTxn, StateVector, Text, TextRef, Transact, Update};

struct Note {
    doc: Doc,
    title: TextRef,
    md: TextRef,
    files: MapRef,
}

impl Note {
    fn new(client_id: u64) -> Note {
        let mut options = Options::default();
        options.offset_kind = OffsetKind::Utf16;
        if client_id != 0 {
            options.client_id = ClientID::new(client_id & ((1u64 << 53) - 1));
        }
        let doc = Doc::with_options(options);
        let title = doc.get_or_insert_text("title");
        let md = doc.get_or_insert_text("md");
        let files = doc.get_or_insert_map("files");
        Note { doc, title, md, files }
    }

    fn text(&self, name: &str) -> &TextRef {
        if name == "title" {
            &self.title
        } else {
            &self.md
        }
    }
}

type Handle = Mutex<Note>;

fn note<'a>(h: jlong) -> &'a Handle {
    unsafe { &*(h as *const Handle) }
}

fn bytes_out(env: &mut JNIEnv, data: &[u8]) -> jbyteArray {
    match env.byte_array_from_slice(data) {
        Ok(a) => a.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

fn string_in(env: &mut JNIEnv, s: &JString) -> String {
    env.get_string(s).map(|s| s.into()).unwrap_or_default()
}

fn any_from_json(v: &serde_json::Value) -> Any {
    match v {
        serde_json::Value::Null => Any::Null,
        serde_json::Value::Bool(b) => Any::Bool(*b),
        // as lib0 writes a JavaScript number: whole numbers as integers, the rest as floats
        serde_json::Value::Number(n) => Any::Number(Number::try_i64(n.as_f64().unwrap_or(0.0))),
        serde_json::Value::String(s) => Any::String(s.as_str().into()),
        serde_json::Value::Array(a) => Any::Array(a.iter().map(any_from_json).collect::<Vec<_>>().into()),
        serde_json::Value::Object(o) => {
            let m: std::collections::HashMap<String, Any> = o.iter().map(|(k, v)| (k.clone(), any_from_json(v))).collect();
            Any::Map(m.into())
        }
    }
}

fn any_to_json(a: &Any) -> serde_json::Value {
    match a {
        Any::Null | Any::Undefined => serde_json::Value::Null,
        Any::Bool(b) => serde_json::Value::Bool(*b),
        Any::Number(Number::Int(i)) => serde_json::Value::from(*i),
        Any::Number(Number::Float(f)) => {
            if f.fract() == 0.0 && f.abs() < 9.0e15 {
                serde_json::Value::from(*f as i64)
            } else {
                serde_json::Number::from_f64(*f).map(serde_json::Value::Number).unwrap_or(serde_json::Value::Null)
            }
        }
        Any::String(s) => serde_json::Value::String(s.to_string()),
        Any::Buffer(_) => serde_json::Value::Null,
        Any::Array(v) => serde_json::Value::Array(v.iter().map(any_to_json).collect()),
        Any::Map(m) => serde_json::Value::Object(m.iter().map(|(k, v)| (k.clone(), any_to_json(v))).collect()),
    }
}

/// A new, empty note document. `client_id` 0 picks a random one, as Yjs does.
#[no_mangle]
pub extern "system" fn Java_fish_nexa_notes_YDoc_nativeNew(_env: JNIEnv, _c: JClass, client_id: jlong) -> jlong {
    Box::into_raw(Box::new(Mutex::new(Note::new(client_id as u64)))) as jlong
}

#[no_mangle]
pub extern "system" fn Java_fish_nexa_notes_YDoc_nativeFree(_env: JNIEnv, _c: JClass, h: jlong) {
    if h != 0 {
        unsafe { drop(Box::from_raw(h as *mut Handle)) };
    }
}

/// Takes in an update someone else made (or a saved document). False if it could not be read.
#[no_mangle]
pub extern "system" fn Java_fish_nexa_notes_YDoc_nativeApply(env: JNIEnv, _c: JClass, h: jlong, update: JByteArray) -> jboolean {
    let data = match env.convert_byte_array(&update) {
        Ok(d) => d,
        Err(_) => return JNI_FALSE,
    };
    let n = note(h).lock().unwrap();
    let decoded = match Update::decode_v1(&data) {
        Ok(u) => u,
        Err(_) => return JNI_FALSE,
    };
    let mut txn = n.doc.transact_mut();
    if txn.apply_update(decoded).is_err() {
        return JNI_FALSE;
    }
    JNI_TRUE
}

/// The whole document as one update (Y.encodeStateAsUpdate).
#[no_mangle]
pub extern "system" fn Java_fish_nexa_notes_YDoc_nativeEncodeState(mut env: JNIEnv, _c: JClass, h: jlong) -> jbyteArray {
    let n = note(h).lock().unwrap();
    let data = n.doc.transact().encode_state_as_update_v1(&StateVector::default());
    bytes_out(&mut env, &data)
}

#[no_mangle]
pub extern "system" fn Java_fish_nexa_notes_YDoc_nativeStateVector(mut env: JNIEnv, _c: JClass, h: jlong) -> jbyteArray {
    let n = note(h).lock().unwrap();
    let data = n.doc.transact().state_vector().encode_v1();
    bytes_out(&mut env, &data)
}

/// What this copy holds that a copy at `state_vector` does not.
#[no_mangle]
pub extern "system" fn Java_fish_nexa_notes_YDoc_nativeDiff(mut env: JNIEnv, _c: JClass, h: jlong, sv: JByteArray) -> jbyteArray {
    let data = env.convert_byte_array(&sv).unwrap_or_default();
    let n = note(h).lock().unwrap();
    let vector = StateVector::decode_v1(&data).unwrap_or_default();
    let out = n.doc.transact().encode_state_as_update_v1(&vector);
    bytes_out(&mut env, &out)
}

#[no_mangle]
pub extern "system" fn Java_fish_nexa_notes_YDoc_nativeText(mut env: JNIEnv, _c: JClass, h: jlong, name: JString) -> jstring {
    let name = string_in(&mut env, &name);
    let n = note(h).lock().unwrap();
    let txn = n.doc.transact();
    let s = n.text(&name).get_string(&txn);
    env.new_string(s).map(|s| s.into_raw()).unwrap_or(std::ptr::null_mut())
}

/// The files map as a JSON object.
#[no_mangle]
pub extern "system" fn Java_fish_nexa_notes_YDoc_nativeFiles(env: JNIEnv, _c: JClass, h: jlong) -> jstring {
    let n = note(h).lock().unwrap();
    let txn = n.doc.transact();
    let any = n.files.to_json(&txn);
    let s = any_to_json(&any).to_string();
    env.new_string(s).map(|s| s.into_raw()).unwrap_or(std::ptr::null_mut())
}

/// Several text edits in one transaction; returns the update they made (empty if nothing changed).
/// `ops` holds triples flattened: text name ("title"/"md"), then "index:delete", then the inserted text.
#[no_mangle]
pub extern "system" fn Java_fish_nexa_notes_YDoc_nativeEdit(mut env: JNIEnv, _c: JClass, h: jlong, ops: JObjectArray) -> jbyteArray {
    let count = env.get_array_length(&ops).unwrap_or(0);
    let mut list: Vec<String> = Vec::with_capacity(count as usize);
    for i in 0..count {
        let o = match env.get_object_array_element(&ops, i) {
            Ok(o) => o,
            Err(_) => return std::ptr::null_mut(),
        };
        let s = string_in(&mut env, &JString::from(o));
        list.push(s);
    }
    let n = note(h).lock().unwrap();
    let update = {
        let mut txn = n.doc.transact_mut();
        for chunk in list.chunks(3) {
            if chunk.len() < 3 {
                break;
            }
            let text = n.text(&chunk[0]);
            let mut parts = chunk[1].split(':');
            let index: u32 = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
            let delete: u32 = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
            let len = text.len(&txn);
            let index = index.min(len);
            let delete = delete.min(len - index);
            if delete > 0 {
                text.remove_range(&mut txn, index, delete);
            }
            if !chunk[2].is_empty() {
                text.insert(&mut txn, index, &chunk[2]);
            }
        }
        txn.encode_update_v1()
    };
    bytes_out(&mut env, &update)
}

/// Sets files in the map (id → JSON value), in one transaction; returns the update.
#[no_mangle]
pub extern "system" fn Java_fish_nexa_notes_YDoc_nativeSetFiles(mut env: JNIEnv, _c: JClass, h: jlong, json: JString) -> jbyteArray {
    let s = string_in(&mut env, &json);
    let value: serde_json::Value = match serde_json::from_str(&s) {
        Ok(v) => v,
        Err(_) => return std::ptr::null_mut(),
    };
    let n = note(h).lock().unwrap();
    let update = {
        let mut txn = n.doc.transact_mut();
        if let serde_json::Value::Object(o) = value {
            let mut keys: Vec<&String> = o.keys().collect();
            keys.sort();
            for k in keys {
                n.files.insert(&mut txn, k.as_str(), any_from_json(&o[k]));
            }
        }
        txn.encode_update_v1()
    };
    bytes_out(&mut env, &update)
}

/// Several updates as one (Y.mergeUpdates).
#[no_mangle]
pub extern "system" fn Java_fish_nexa_notes_YDoc_nativeMerge(mut env: JNIEnv, _c: JClass, updates: JObjectArray) -> jbyteArray {
    let count = env.get_array_length(&updates).unwrap_or(0);
    let mut all: Vec<Vec<u8>> = Vec::with_capacity(count as usize);
    for i in 0..count {
        let o = match env.get_object_array_element(&updates, i) {
            Ok(o) => o,
            Err(_) => return std::ptr::null_mut(),
        };
        let arr = JByteArray::from(o);
        all.push(env.convert_byte_array(&arr).unwrap_or_default());
    }
    let refs: Vec<&[u8]> = all.iter().map(|v| v.as_slice()).collect();
    match yrs::merge_updates_v1(&refs) {
        Ok(out) => bytes_out(&mut env, &out),
        Err(_) => std::ptr::null_mut(),
    }
}

/// Length of a text in UTF-16 code units.
#[no_mangle]
pub extern "system" fn Java_fish_nexa_notes_YDoc_nativeLength(mut env: JNIEnv, _c: JClass, h: jlong, name: JString) -> jint {
    let name = string_in(&mut env, &name);
    let n = note(h).lock().unwrap();
    let txn = n.doc.transact();
    n.text(&name).len(&txn) as jint
}
