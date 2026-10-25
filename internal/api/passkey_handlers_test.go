package api

import (
	"encoding/base64"
	"encoding/json"
	"testing"

	"evilion.xyz/chat/internal/webauthn"
	"evilion.xyz/chat/internal/webauthn/fake"
)

func passkeyClientData(typ, challenge, origin string) []byte {
	b, _ := json.Marshal(webauthn.ClientData{Type: typ, Challenge: challenge, Origin: origin})
	return b
}

// addPasskey goes through Settings' Add a Passkey as the app does, and returns
// the software authenticator holding it.
func addPasskey(t *testing.T, srvURL string, do2 func(method, path, token string, body any) (int, map[string]any), token string) *fake.Authenticator {
	t.Helper()
	code, opts := do2("POST", "/api/v1/auth/passkeys/options", token, map[string]any{"auth_key": b64(key32)})
	if code != 200 {
		t.Fatalf("options: %d %v", code, opts)
	}
	pk := opts["public_key"].(map[string]any)
	if pk["rp"].(map[string]any)["id"] != "localhost" {
		t.Fatalf("rp: %v", pk["rp"])
	}
	a := fake.New(webauthn.AlgES256)
	code, body := do2("POST", "/api/v1/auth/passkeys", token, map[string]any{
		"ticket": opts["ticket"], "name": "Laptop",
		"client_data_json":   b64(passkeyClientData("webauthn.create", pk["challenge"].(string), "http://localhost")),
		"attestation_object": b64(a.Create("localhost")),
		"enc_private_key":    b64([]byte("wrapped-by-prf")),
	})
	if code != 200 || body["name"] != "Laptop" {
		t.Fatalf("create: %d %v", code, body)
	}
	return a
}

func TestPasskeySignsInAndHandsBackItsKey(t *testing.T) {
	_, ts := newTestServer(t)
	token, id := register(t, ts, "pia")
	do2 := func(method, path, token string, body any) (int, map[string]any) {
		res, b := do(t, ts, method, path, token, body)
		return res.StatusCode, b
	}
	if code, body := do2("POST", "/api/v1/auth/passkeys/options", token, map[string]any{"auth_key": b64(key32b)}); code != 401 {
		t.Fatalf("a wrong password started a passkey: %d %v", code, body)
	}
	a := addPasskey(t, ts.URL, do2, token)

	signIn := func(origin string, a *fake.Authenticator) (int, map[string]any) {
		_, begin := do2("POST", "/api/v1/auth/passkey/begin", "", map[string]any{})
		ch := begin["public_key"].(map[string]any)["challenge"].(string)
		cd := passkeyClientData("webauthn.get", ch, origin)
		ad, sig := a.Get("localhost", cd)
		return do2("POST", "/api/v1/auth/passkey/finish", "", map[string]any{
			"ticket": begin["ticket"], "credential_id": b64(a.ID), "client_data_json": b64(cd),
			"authenticator_data": b64(ad), "signature": b64(sig),
		})
	}
	code, body := signIn("http://localhost", a)
	if code != 200 || body["user"].(map[string]any)["id"] != id || body["token"] == "" {
		t.Fatalf("sign in: %d %v", code, body)
	}
	if got, _ := base64.StdEncoding.DecodeString(body["enc_private_key"].(string)); string(got) != "wrapped-by-prf" {
		t.Fatalf("the wrapped key did not come back: %q", got)
	}
	if code, _ := do2("GET", "/api/v1/users/@me", body["token"].(string), nil); code != 200 {
		t.Fatalf("the new session does not work: %d", code)
	}
	if code, body := signIn("https://evil.example", a); code != 401 {
		t.Fatalf("another site's page signed in: %d %v", code, body)
	}
	if code, body := signIn("http://localhost", fake.New(webauthn.AlgES256)); code != 401 || errCode(body) != "passkey_unknown" {
		t.Fatalf("an unknown passkey: %d %v", code, body)
	}

	// the same answer twice signs in once
	_, begin := do2("POST", "/api/v1/auth/passkey/begin", "", map[string]any{})
	cd := passkeyClientData("webauthn.get", begin["public_key"].(map[string]any)["challenge"].(string), "http://localhost")
	ad, sig := a.Get("localhost", cd)
	answer := map[string]any{"ticket": begin["ticket"], "credential_id": b64(a.ID), "client_data_json": b64(cd), "authenticator_data": b64(ad), "signature": b64(sig)}
	if code, _ := do2("POST", "/api/v1/auth/passkey/finish", "", answer); code != 200 {
		t.Fatalf("first use: %d", code)
	}
	if code, _ := do2("POST", "/api/v1/auth/passkey/finish", "", answer); code != 401 {
		t.Fatalf("a replayed answer signed in again: %d", code)
	}

	// listed, renamed, removed; then it signs nobody in
	_, lb := do(t, ts, "GET", "/api/v1/auth/passkeys", token, nil)
	list, _ := lb["_list"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["rp_id"] != "localhost" {
		t.Fatalf("list: %v", lb)
	}
	if _, ok := list[0].(map[string]any)["enc_private_key"]; ok {
		t.Fatal("the list gives out the wrapped key")
	}
	pid := list[0].(map[string]any)["id"].(string)
	if code, _ := do2("PATCH", "/api/v1/auth/passkeys/"+pid, token, map[string]any{"name": "Phone"}); code != 204 {
		t.Fatalf("rename: %d", code)
	}
	other, _ := register(t, ts, "oscar")
	if code, _ := do2("DELETE", "/api/v1/auth/passkeys/"+pid, other, nil); code != 404 {
		t.Fatalf("someone else removed it: %d", code)
	}
	if code, _ := do2("DELETE", "/api/v1/auth/passkeys/"+pid, token, nil); code != 204 {
		t.Fatalf("delete: %d", code)
	}
	if code, _ := signIn("http://localhost", a); code != 401 {
		t.Fatalf("a removed passkey signed in: %d", code)
	}
}

func TestPasskeyCreateChecksTheAnswer(t *testing.T) {
	_, ts := newTestServer(t)
	token, _ := register(t, ts, "quinn")
	_, opts := do(t, ts, "POST", "/api/v1/auth/passkeys/options", token, map[string]any{"auth_key": b64(key32)})
	ch := opts["public_key"].(map[string]any)["challenge"].(string)
	a := fake.New(webauthn.AlgEdDSA)
	try := func(origin, rp string) int {
		res, _ := do(t, ts, "POST", "/api/v1/auth/passkeys", token, map[string]any{
			"ticket": opts["ticket"], "client_data_json": b64(passkeyClientData("webauthn.create", ch, origin)),
			"attestation_object": b64(a.Create(rp)), "enc_private_key": b64([]byte("x")),
		})
		return res.StatusCode
	}
	if try("https://evil.example", "localhost") != 400 {
		t.Fatal("a passkey made on another site's page was kept")
	}
	if try("http://localhost", "evil.example") != 400 {
		t.Fatal("a passkey for another site was kept")
	}
	if try("http://localhost", "localhost") != 200 {
		t.Fatal("a good passkey was refused")
	}
	if try("http://localhost", "localhost") != 400 {
		t.Fatal("the same challenge made a second passkey")
	}
}
