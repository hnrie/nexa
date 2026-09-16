package main

// Starts the test Postgres and leaves it running until interrupted.
import (
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"
)

func main() {
	dir := filepath.Join(os.TempDir(), "chatd-pgtest")
	pg := embeddedpostgres.NewDatabase(embeddedpostgres.DefaultConfig().
		Username("chat").Password("chat").Database("chat").Port(55432).
		RuntimePath(filepath.Join(dir, "runtime")).
		DataPath(filepath.Join(dir, "data-shared")).
		BinariesPath(filepath.Join(dir, "bin")).
		StartTimeout(90 * time.Second))
	if err := pg.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "start:", err)
		os.Exit(1)
	}
	fmt.Println("postgres://chat:chat@127.0.0.1:55432/chat?sslmode=disable")
	c := make(chan os.Signal, 1)
	signal.Notify(c, syscall.SIGINT, syscall.SIGTERM)
	<-c
	_ = pg.Stop()
}
