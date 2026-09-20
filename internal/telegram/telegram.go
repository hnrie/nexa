// Package telegram talks to the Telegram Bot API just enough to import a
// sticker set: read the set, then download each sticker file. The bot token
// stays on the server that configured it; nothing here ever goes near a
// client.
package telegram

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// APIBase is the Bot API root. A variable rather than a constant so tests can
// point it at a local server; production never changes it.
var APIBase = "https://api.telegram.org"

// FileBase is where downloaded files live under the API root.
var FileBase = "https://api.telegram.org/file"

// SetNameRE is what a sticker set name may hold. Telegram names look like
// AnimalsByBot, but the check stays looser than that on purpose.
var SetNameRE = regexp.MustCompile(`^[A-Za-z0-9_]{1,64}$`)

// MaxStickers bounds one import. Telegram sets hold at most a few hundred
// stickers and each needs its own download, so an import without a ceiling is
// a request that runs until something else gives up first.
const MaxStickers = 200

// Sticker is one entry of a set: enough to fetch its file and to name it.
type Sticker struct {
	FileID   string `json:"file_id"`
	Emoji    string `json:"emoji"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	IsVideo  bool   `json:"is_video"`
	IsAnim   bool   `json:"is_animated"`
	SetName  string `json:"set_name"`
}

// StickerSet is what getStickerSet answers with.
type StickerSet struct {
	Name     string    `json:"name"`
	Title    string    `json:"title"`
	Stickers []Sticker `json:"stickers"`
}

// BotFile is what getFile answers with.
type BotFile struct {
	FileID   string `json:"file_id"`
	FilePath string `json:"file_path"`
	FileSize int64  `json:"file_size"`
}

// Client fetches sticker sets with one bot's token.
type Client struct {
	Token string
	HTTP  *http.Client
}

// NewClient builds a Client with sane timeouts. One request is quick; an
// import is many of them, and the handler bounds the total by capping the
// stickers, not by rushing any single fetch.
func NewClient(token string) *Client {
	return &Client{Token: token, HTTP: &http.Client{Timeout: 20 * time.Second}}
}

func apiErr(code int, msg string) error {
	return &Error{Code: code, Message: msg}
}

// Error is a Bot API failure with its HTTP status attached.
type Error struct {
	Code    int
	Message string
}

func (e *Error) Error() string { return fmt.Sprintf("telegram: %s", e.Message) }

// ParseSetName takes what a person pastes — a t.me/addstickers link, a
// telegram.me link, or a bare set name — and returns the set name, or an
// error saying what was wrong with it.
func ParseSetName(input string) (string, error) {
	s := strings.TrimSpace(input)
	if s == "" {
		return "", errors.New("paste a Telegram sticker pack link, like https://t.me/addstickers/Animals")
	}
	if !strings.Contains(s, "://") && !strings.HasPrefix(s, "t.me/") && !strings.HasPrefix(s, "telegram.me/") {
		if !SetNameRE.MatchString(s) {
			return "", errors.New("that is not a sticker pack link or set name")
		}
		return s, nil
	}
	lower := strings.ToLower(s)
	if strings.HasPrefix(lower, "t.me/") || strings.HasPrefix(lower, "telegram.me/") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil {
		return "", errors.New("that link could not be read")
	}
	host := strings.ToLower(u.Host)
	if host != "t.me" && host != "telegram.me" && host != "www.t.me" && host != "www.telegram.me" {
		return "", errors.New("that is not a Telegram link")
	}
	parts := strings.Split(strings.Trim(u.EscapedPath(), "/"), "/")
	if len(parts) != 2 || !strings.EqualFold(parts[0], "addstickers") || !SetNameRE.MatchString(parts[1]) {
		return "", errors.New("that is not a sticker pack link: it should look like https://t.me/addstickers/Animals")
	}
	return parts[1], nil
}

func (c *Client) call(ctx context.Context, method string, args url.Values, out any) error {
	endpoint := strings.TrimSuffix(APIBase, "/") + "/bot" + c.Token + "/" + method
	if args != nil {
		endpoint += "?" + args.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	if err != nil {
		return err
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return err
	}
	var parsed struct {
		OK          bool            `json:"ok"`
		Result      json.RawMessage `json:"result"`
		Description string          `json:"description"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return apiErr(res.StatusCode, "Telegram answered something unexpected")
	}
	if !parsed.OK {
		msg := parsed.Description
		if msg == "" {
			msg = "Telegram refused the request"
		}
		return apiErr(res.StatusCode, msg)
	}
	if out != nil {
		if err := json.Unmarshal(parsed.Result, out); err != nil {
			return apiErr(res.StatusCode, "Telegram answered something unexpected")
		}
	}
	return nil
}

// GetStickerSet reads a set by name. A missing or private set comes back as
// an error carrying Telegram's own explanation.
func (c *Client) GetStickerSet(ctx context.Context, name string) (*StickerSet, error) {
	var set StickerSet
	if err := c.call(ctx, "getStickerSet", url.Values{"name": {name}}, &set); err != nil {
		return nil, err
	}
	if set.Name == "" {
		set.Name = name
	}
	return &set, nil
}

// FileURL answers where a file_path downloads from.
func (c *Client) FileURL(filePath string) string {
	return strings.TrimSuffix(FileBase, "/") + "/bot" + c.Token + "/" + strings.TrimPrefix(filePath, "/")
}

// GetFile resolves a file_id to its downloadable path.
func (c *Client) GetFile(ctx context.Context, fileID string) (*BotFile, error) {
	var f BotFile
	if err := c.call(ctx, "getFile", url.Values{"file_id": {fileID}}, &f); err != nil {
		return nil, err
	}
	if f.FilePath == "" {
		return nil, errors.New("Telegram gave no file for that sticker")
	}
	return &f, nil
}

// DownloadFile fetches a file, stopping past maxBytes so one huge file cannot
// eat the import. It returns ErrTooLarge in that case, with no partial file.
func (c *Client) DownloadFile(ctx context.Context, fileURL string, maxBytes int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", fileURL, nil)
	if err != nil {
		return nil, err
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Telegram answered %d for that file", res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > maxBytes {
		return nil, errors.New("that file is larger than this server accepts for a sticker")
	}
	return body, nil
}
