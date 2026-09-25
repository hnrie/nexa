//go:build !linux && !darwin

package main

// sqliteInUse cannot ask this system about SQLite's locks, so it trusts the
// operator to have stopped chatd, as the usage text says.
func sqliteInUse(path string) (bool, error) { return false, nil }
