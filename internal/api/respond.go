package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

// WriteJSON encodes v with the given status.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}

// ReadJSON decodes the body into dst, bounded by maxBytes.
func ReadJSON(w http.ResponseWriter, r *http.Request, dst any, maxBytes int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return ErrTooLarge
		}
		return ErrBadJSON
	}
	if _, err := dec.Token(); err != io.EOF {
		return ErrBadJSON
	}
	return nil
}
