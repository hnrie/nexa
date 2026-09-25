package main

import (
	"fmt"
	"os"
	"sync"
)

// Past logFileMax bytes the log file starts again, and logFileKeep of the old
// ones are kept beside it as chatd.log.1 (newest) … chatd.log.5.
const (
	logFileMax  = 10 << 20
	logFileKeep = 5
)

// rotatingFile is a log file chatd writes and rotates itself, for a service
// manager that only knows how to append stdout to a file. launchd holds that
// file open for as long as chatd runs, so nothing outside can rotate it — a
// rotated name goes on growing under the descriptor launchd still has — and
// it used to grow for good on the disk the database is on.
type rotatingFile struct {
	mu   sync.Mutex
	path string
	max  int64
	keep int
	f    *os.File
	size int64
}

func openRotating(path string, max int64, keep int) (*rotatingFile, error) {
	r := &rotatingFile{path: path, max: max, keep: keep}
	if err := r.open(); err != nil {
		return nil, err
	}
	return r, nil
}

func (r *rotatingFile) open() error {
	f, err := os.OpenFile(r.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o640)
	if err != nil {
		return err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return err
	}
	r.f, r.size = f, info.Size()
	return nil
}

// Write appends one log record, starting a new file first when this one would
// grow past the limit. A record is never split between two files.
func (r *rotatingFile) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.size > 0 && r.size+int64(len(p)) > r.max {
		// a rotation that fails keeps writing where it was: a log that grows
		// is better than one that stops
		_ = r.rotate()
	}
	n, err := r.f.Write(p)
	r.size += int64(n)
	return n, err
}

// rotate shifts chatd.log.N up by one, dropping the oldest, and starts an
// empty chatd.log.
func (r *rotatingFile) rotate() error {
	for i := r.keep - 1; i >= 1; i-- {
		_ = os.Rename(fmt.Sprintf("%s.%d", r.path, i), fmt.Sprintf("%s.%d", r.path, i+1))
	}
	if err := os.Rename(r.path, r.path+".1"); err != nil {
		return err
	}
	old := r.f
	if err := r.open(); err != nil {
		// put the name back so the next record still lands somewhere findable
		_ = os.Rename(r.path+".1", r.path)
		return err
	}
	return old.Close()
}
