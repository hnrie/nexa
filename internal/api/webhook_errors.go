package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"evilion.xyz/chat/internal/media"
	"evilion.xyz/chat/internal/store"
)

// A webhook URL is used by programs written for Discord's webhooks, which
// read errors in Discord's shape — {"message": ..., "code": 50035, "errors":
// {...}} — rather than this API's own, so the routes that take a webhook's
// token answer in that shape, with Discord's JSON error codes. The routes
// the app itself uses to manage webhooks answer like every other route.

// dError is an error in Discord's shape.
type dError struct {
	Status  int
	Code    int
	Message string
	// Form, for 50035, says which fields were wrong and why.
	Form *formErrors
}

func (e *dError) Error() string { return strconv.Itoa(e.Code) + ": " + e.Message }

func dErr(status, code int, msg string) *dError {
	return &dError{Status: status, Code: code, Message: msg}
}

var (
	dErrUnknownWebhook = dErr(http.StatusNotFound, 10015, "Unknown Webhook")
	dErrBadToken       = dErr(http.StatusUnauthorized, 50027, "Invalid Webhook Token")
	dErrUnknownChannel = dErr(http.StatusNotFound, 10003, "Unknown Channel")
	dErrUnknownMessage = dErr(http.StatusNotFound, 10008, "Unknown Message")
	dErrEmpty          = dErr(http.StatusBadRequest, 50006, "Cannot send an empty message")
	dErrBadJSON        = dErr(http.StatusBadRequest, 50109, "The request body contains invalid JSON.")
	dErrTooLarge       = dErr(http.StatusRequestEntityTooLarge, 40005, "Request entity too large")
	dErrFileTooLarge   = dErr(http.StatusRequestEntityTooLarge, 50045, "File uploaded exceeds the maximum size")
	dErrThreadName     = dErr(http.StatusBadRequest, 220003, "Webhooks can only create threads in forum channels")
	dErrNotText        = dErr(http.StatusBadRequest, 50008, "Cannot send messages in a non-text channel")
	dErrMethod         = dErr(http.StatusMethodNotAllowed, 0, "405: Method Not Allowed")
	dErrInternal       = dErr(http.StatusInternalServerError, 0, "500: Internal Server Error")
)

// formErrors collects what was wrong with a request body, by where it was
// wrong: {"embeds": {"0": {"title": {"_errors": [{code, message}]}}}}.
type formErrors struct {
	node map[string]any
}

type formError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// add records a problem at path ("embeds", "0", "title").
func (f *formErrors) add(path []string, code, msg string) {
	if f.node == nil {
		f.node = map[string]any{}
	}
	cur := f.node
	for _, p := range path {
		next, ok := cur[p].(map[string]any)
		if !ok {
			next = map[string]any{}
			cur[p] = next
		}
		cur = next
	}
	list, _ := cur["_errors"].([]formError)
	cur["_errors"] = append(list, formError{Code: code, Message: msg})
}

func (f *formErrors) empty() bool { return f == nil || len(f.node) == 0 }

// first is one problem, as "path: message", for a line of text.
func (f *formErrors) first() string {
	var walk func(prefix string, n map[string]any) string
	walk = func(prefix string, n map[string]any) string {
		if list, ok := n["_errors"].([]formError); ok && len(list) > 0 {
			return strings.TrimPrefix(prefix, ".") + ": " + list[0].Message
		}
		keys := make([]string, 0, len(n))
		for k := range n {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			if child, ok := n[k].(map[string]any); ok {
				if s := walk(prefix+"."+k, child); s != "" {
					return s
				}
			}
		}
		return ""
	}
	return walk("", f.node)
}

func (f *formErrors) err() *dError {
	return &dError{Status: http.StatusBadRequest, Code: 50035, Message: "Invalid Form Body", Form: f}
}

// writeDiscordError answers with err in Discord's shape. Store and media
// errors map the way WriteError maps them.
func writeDiscordError(w http.ResponseWriter, err error) {
	var de *dError
	var apiErr *Error
	switch {
	case errors.As(err, &de):
	case errors.As(err, &apiErr):
		de = dErr(apiErr.Status, 0, apiErr.Message)
	case errors.Is(err, store.ErrNotFound), errors.Is(err, media.ErrNotFound):
		de = dErrUnknownWebhook
	case errors.Is(err, media.ErrTooLarge):
		de = dErrFileTooLarge
	default:
		slog.Error("webhook: internal error", "err", err)
		de = dErrInternal
	}
	body := map[string]any{"message": de.Message, "code": de.Code}
	if !de.Form.empty() {
		body["errors"] = de.Form.node
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(de.Status)
	_ = json.NewEncoder(w).Encode(body)
}
