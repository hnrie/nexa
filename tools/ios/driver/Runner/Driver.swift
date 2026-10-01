import ObjectiveC
import XCTest

/// XCUITest waits before and after every event for the app to stop animating,
/// up to a minute each time. A page with anything that keeps moving never
/// stops, so the waits are taken out.
final class NoWait: NSObject {
  @objc func idle(_ animations: Bool) {}
  @objc func idle(_ animations: Bool, isPreEvent: Bool) {}

  static func install() {
    guard let process = objc_getClass("XCUIApplicationProcess") as? AnyClass else { return }
    let swaps: [(String, Selector)] = [
      ("waitForQuiescenceIncludingAnimationsIdle:", #selector(NoWait.idle(_:))),
      ("waitForQuiescenceIncludingAnimationsIdle:isPreEvent:", #selector(NoWait.idle(_:isPreEvent:))),
    ]
    for (name, ours) in swaps {
      if let theirs = class_getInstanceMethod(process, Selector((name))), let mine = class_getInstanceMethod(NoWait.self, ours) {
        method_setImplementation(theirs, method_getImplementation(mine))
      }
    }
  }
}

/// Plays what tools/ios_sim.py asks for on the simulator: real touches, and
/// real taps on the keys of the on-screen keyboard, which is the one thing a
/// browser's own automation does not bring up. A command is a file
/// cmd-<n>.json in the queue folder (SIM_QUEUE), its answer res-<n>.json.
final class Driver: XCTestCase {
  let dir = ProcessInfo.processInfo.environment["SIM_QUEUE"] ?? "/tmp/nexa-sim-queue"

  func testDrive() throws {
    continueAfterFailure = true
    NoWait.install()
    var app = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
    let fm = FileManager.default
    var n = 0
    try? "ready".write(toFile: dir + "/ready", atomically: true, encoding: .utf8)
    while true {
      let path = dir + "/cmd-\(n).json"
      guard fm.fileExists(atPath: path), let data = fm.contents(atPath: path),
            let cmd = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
        usleep(40_000)
        continue
      }
      var out: [String: Any] = ["ok": true]
      let op = cmd["op"] as? String ?? ""
      func num(_ k: String, _ d: Double = 0) -> Double { (cmd[k] as? NSNumber)?.doubleValue ?? d }
      // points on the screen, from its top left corner
      func at(_ x: Double, _ y: Double) -> XCUICoordinate {
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: y))
      }
      switch op {
      case "quit":
        write(n, out)
        return
      case "app":
        app = XCUIApplication(bundleIdentifier: cmd["id"] as? String ?? "com.apple.mobilesafari")
        app.activate()
      case "tap":
        at(num("x"), num("y")).tap()
      case "press":
        at(num("x"), num("y")).press(forDuration: num("d", 0.8))
      case "drag":
        at(num("x"), num("y")).press(forDuration: 0.05, thenDragTo: at(num("x2"), num("y2")), withVelocity: XCUIGestureVelocity(CGFloat(num("v", 600))), thenHoldForDuration: 0)
      case "key":
        // a key of the on-screen keyboard, tapped the way a finger would
        let name = cmd["name"] as? String ?? ""
        let kb = app.keyboards.firstMatch
        var el = kb.keys[name].firstMatch
        if !el.exists { el = kb.buttons[name].firstMatch }
        if el.exists { el.tap() } else { out = ["ok": false, "error": "no key \(name)"] }
      case "keyboard":
        let kb = app.keyboards.firstMatch
        out["shown"] = kb.exists
        if kb.exists {
          let f = kb.frame
          out["frame"] = [f.origin.x, f.origin.y, f.size.width, f.size.height]
        }
      case "button":
        // anything the system draws that has a name: Safari's bars, the keyboard's Next and Previous, a Home Screen icon
        let name = cmd["name"] as? String ?? ""
        var el = app.buttons[name].firstMatch
        if !el.exists { el = app.descendants(matching: .any)[name].firstMatch }
        if el.exists {
          let f = el.frame
          out["frame"] = [f.origin.x, f.origin.y, f.size.width, f.size.height]
          el.tap()
        } else { out = ["ok": false, "error": "no element \(name)"] }
      case "tree":
        out["tree"] = app.debugDescription
      case "home":
        XCUIDevice.shared.press(.home)
      case "rotate":
        XCUIDevice.shared.orientation = (cmd["to"] as? String) == "landscape" ? .landscapeLeft : .portrait
      default:
        out = ["ok": false, "error": "unknown op \(op)"]
      }
      write(n, out)
      n += 1
    }
  }

  func write(_ n: Int, _ out: [String: Any]) {
    let data = (try? JSONSerialization.data(withJSONObject: out)) ?? Data("{}".utf8)
    let tmp = dir + "/res-\(n).tmp"
    FileManager.default.createFile(atPath: tmp, contents: data)
    try? FileManager.default.moveItem(atPath: tmp, toPath: dir + "/res-\(n).json")
  }
}
