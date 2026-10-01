import SwiftUI

/// A UI test bundle needs an app to be hosted by. This one does nothing.
@main
struct HostApp: App {
  var body: some Scene {
    WindowGroup { Text("simulator driver") }
  }
}
