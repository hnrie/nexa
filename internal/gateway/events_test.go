package gateway

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// The server's events are named by string wherever they are sent, and the
// clients switch on those strings: a typo compiles, ships, and is an event no
// client ever handles. So every name sent — by the handlers or by the hub —
// has to be one of the Ev constants here, and every constant has to be sent
// somewhere, or it is a name the protocol only pretends to have.
func TestEveryEventSentIsNamedHere(t *testing.T) {
	known := map[string]string{}
	sent := map[string]bool{}
	fset := token.NewFileSet()
	parse := func(dir string) []*ast.File {
		paths, err := filepath.Glob(filepath.Join(dir, "*.go"))
		if err != nil {
			t.Fatal(err)
		}
		var files []*ast.File
		for _, p := range paths {
			if strings.HasSuffix(p, "_test.go") {
				continue
			}
			f, err := parser.ParseFile(fset, p, nil, 0)
			if err != nil {
				t.Fatal(err)
			}
			files = append(files, f)
		}
		return files
	}
	own := parse(".")
	for _, f := range own {
		for _, d := range f.Decls {
			g, ok := d.(*ast.GenDecl)
			if !ok || g.Tok != token.CONST {
				continue
			}
			for _, spec := range g.Specs {
				v := spec.(*ast.ValueSpec)
				for i, name := range v.Names {
					if !strings.HasPrefix(name.Name, "Ev") || i >= len(v.Values) {
						continue
					}
					if lit, ok := v.Values[i].(*ast.BasicLit); ok && lit.Kind == token.STRING {
						s, _ := strconv.Unquote(lit.Value)
						known[s] = name.Name
					}
				}
			}
		}
	}
	// the argument that names the event, by method — the hub's, and the api
	// package's helpers that pass one through
	eventArg := map[string]int{"EmitUsers": 1, "EmitChannel": 1, "emitUsersExcept": 2, "EmitAll": 0, "EmitConn": 2, "Send": 0,
		"emitServer": 2, "emitServerWithPerm": 3, "emitStaff": 1, "emitConn": 2, "removeMember": 3}
	var unknown []string
	for _, f := range append(own, parse("../api")...) {
		ast.Inspect(f, func(n ast.Node) bool {
			// frames the hub builds itself: ServerFrame{T: EvReady, …}
			if lit, ok := n.(*ast.CompositeLit); ok {
				if id, ok := lit.Type.(*ast.Ident); ok && id.Name == "ServerFrame" {
					for _, el := range lit.Elts {
						if kv, ok := el.(*ast.KeyValueExpr); ok {
							if k, ok := kv.Key.(*ast.Ident); ok && k.Name == "T" {
								if v, ok := kv.Value.(*ast.Ident); ok {
									for s, name := range known {
										if name == v.Name {
											sent[s] = true
										}
									}
								}
							}
						}
					}
				}
				return true
			}
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			at, ok := eventArg[sel.Sel.Name]
			if !ok || at >= len(call.Args) {
				return true
			}
			switch arg := call.Args[at].(type) {
			case *ast.BasicLit:
				if arg.Kind != token.STRING {
					return true
				}
				s, _ := strconv.Unquote(arg.Value)
				if _, ok := known[s]; !ok {
					unknown = append(unknown, s+" at "+fset.Position(arg.Pos()).String())
				}
				sent[s] = true
			case *ast.SelectorExpr:
				// gateway.EvSomething from the api package
				for s, name := range known {
					if name == arg.Sel.Name {
						sent[s] = true
					}
				}
			case *ast.Ident:
				for s, name := range known {
					if name == arg.Name {
						sent[s] = true
					}
				}
			}
			return true
		})
	}
	sort.Strings(unknown)
	for _, u := range unknown {
		t.Errorf("event %s is not one of the Ev constants", u)
	}
	var never []string
	for s, name := range known {
		if !sent[s] {
			never = append(never, name+" ("+s+")")
		}
	}
	sort.Strings(never)
	for _, n := range never {
		t.Errorf("%s is never sent", n)
	}
}
