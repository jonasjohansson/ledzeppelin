// LEDZeppelin.app launcher stub.
//
// The bundle's main executable used to be the Bun-compiled daemon itself — a plain
// server process that never connects to the window server, so from the Dock's point
// of view the "app" immediately stopped responding ("Application Not Responding").
//
// This stub is the real macOS app: it runs an NSApplication event loop (so the Dock,
// Apple Events and Quit all behave), spawns the daemon (`ledzeppelin-daemon`, the Bun
// binary beside it) as a child process, kills it on quit, and re-opens the browser UI
// when the Dock icon is clicked. Compiled by scripts/build-macapp.sh with swiftc.
import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    let daemon = Process()

    func applicationDidFinishLaunching(_ note: Notification) {
        let dir = Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS")
        daemon.executableURL = dir.appendingPathComponent("ledzeppelin-daemon")
        // Packaged-app behaviour: quit when the last window closes (LZ_AUTOQUIT) so a
        // windowless daemon can't linger, and take over a running instance on launch
        // (LZ_TAKEOVER) so an update actually applies. CLI/dev runs set neither.
        var env = ProcessInfo.processInfo.environment
        env["LZ_AUTOQUIT"] = "1"; env["LZ_TAKEOVER"] = "1"
        daemon.environment = env
        // Daemon dies (crash or clean exit) → the app has nothing left to do.
        daemon.terminationHandler = { _ in DispatchQueue.main.async { NSApp.terminate(nil) } }
        do { try daemon.run() } catch {
            NSLog("LEDZeppelin: failed to start daemon: \(error.localizedDescription)")
            NSApp.terminate(nil)
        }
    }

    // Dock icon click (no windows to show) → (re)open the UI in the browser.
    func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if let url = URL(string: "http://localhost:7070/") { NSWorkspace.shared.open(url) }
        return false
    }

    func applicationWillTerminate(_ note: Notification) {
        if daemon.isRunning { daemon.terminate() }   // SIGTERM — the daemon exits cleanly
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)

// Minimal menu so ⌘Q works when the stub is frontmost (Dock → Quit works regardless).
let menubar = NSMenu()
let appMenuItem = NSMenuItem()
menubar.addItem(appMenuItem)
let appMenu = NSMenu()
appMenu.addItem(NSMenuItem(title: "Quit LEDZeppelin", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
appMenuItem.submenu = appMenu
app.mainMenu = menubar

app.run()
