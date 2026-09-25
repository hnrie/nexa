//go:build linux || darwin

package main

import (
	"errors"
	"io"
	"os"
	"syscall"
)

// sqliteInUse reports whether another process has the SQLite database at path
// open. Every connection to a database in WAL mode holds a shared lock on one
// byte of its -shm file (SQLite's "dead man switch", offset 128) for as long
// as it is open, and the lock goes when the process does, however it ends —
// so asking whether that byte could be locked exclusively answers exactly
// "is chatd, or anything else, still running on this file".
//
// It must be asked before this process opens the database itself: closing any
// descriptor of a file drops every lock the process holds on it.
func sqliteInUse(path string) (bool, error) {
	f, err := os.OpenFile(path+"-shm", os.O_RDWR, 0)
	if errors.Is(err, os.ErrNotExist) {
		// no shared memory file: nobody has it open in WAL mode
		return false, nil
	}
	if err != nil {
		return false, err
	}
	defer f.Close()
	lk := syscall.Flock_t{Type: syscall.F_WRLCK, Whence: io.SeekStart, Start: 128, Len: 1}
	if err := syscall.FcntlFlock(f.Fd(), syscall.F_GETLK, &lk); err != nil {
		return false, err
	}
	return lk.Type != syscall.F_UNLCK, nil
}
