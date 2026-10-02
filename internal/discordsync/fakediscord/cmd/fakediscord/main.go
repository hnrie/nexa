// Command fakediscord runs the fake Discord for end-to-end runs of the
// activity sync (tools/discord_e2e.py). Point chatd at it with
// DISCORD_API_URL=<printed address>/api/v10 and the fake's own keys:
// DISCORD_CLIENT_ID=client-id DISCORD_CLIENT_SECRET=client-secret
// DISCORD_BOT_TOKEN=bot-token.
//
// Besides Discord's routes it takes four of its own, for the run to act as
// people on Discord and as whoever set the application up:
//
//	POST /_control/user?id=&username=   makes an account; answers with a sign-in code
//	POST /_control/presence?id=&status= sets what the account is doing (body: a JSON list of activities)
//	POST /_control/leave?id=            takes the account out of the server
//	POST /_control/redirects            lists the application's redirects (body: a JSON list of addresses)
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"

	"evilion.xyz/chat/internal/discordsync/fakediscord"
)

func main() {
	f := fakediscord.New()
	defer f.Close()
	ctl := http.NewServeMux()
	ctl.HandleFunc("POST /_control/user", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, f.AddUser(r.URL.Query().Get("id"), r.URL.Query().Get("username")))
	})
	ctl.HandleFunc("POST /_control/presence", func(w http.ResponseWriter, r *http.Request) {
		var acts []map[string]any
		_ = json.NewDecoder(r.Body).Decode(&acts)
		f.Presence(r.URL.Query().Get("id"), r.URL.Query().Get("status"), acts...)
	})
	ctl.HandleFunc("POST /_control/leave", func(w http.ResponseWriter, r *http.Request) {
		f.Leave(r.URL.Query().Get("id"))
	})
	ctl.HandleFunc("POST /_control/redirects", func(w http.ResponseWriter, r *http.Request) {
		var list []string
		_ = json.NewDecoder(r.Body).Decode(&list)
		f.Redirects(list...)
	})
	f.Config.Handler = withControl(ctl, f.Config.Handler)
	fmt.Println(f.URL)
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	<-stop
}

func withControl(ctl *http.ServeMux, rest http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if len(r.URL.Path) > 10 && r.URL.Path[:10] == "/_control/" {
			ctl.ServeHTTP(w, r)
			return
		}
		rest.ServeHTTP(w, r)
	})
}
