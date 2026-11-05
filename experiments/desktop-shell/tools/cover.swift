// Covers a screen rectangle with an opaque window above everything else, so a
// shell window underneath is occluded without taking over the rest of the screen.
//
//   tools/bin/cover <x> <y> <width> <height> <seconds>   (top-left origin, points)
import AppKit

let values = CommandLine.arguments.dropFirst().compactMap { Double($0) }
guard values.count == 5 else { fatalError("usage: cover x y width height seconds") }
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let screen = NSScreen.screens[0].frame
let window = NSWindow(
  contentRect: NSRect(
    x: values[0], y: screen.height - values[1] - values[3], width: values[2], height: values[3]),
  styleMask: .borderless, backing: .buffered, defer: false)
window.level = .screenSaver
window.isOpaque = true
window.backgroundColor = .darkGray
window.orderFrontRegardless()
Timer.scheduledTimer(withTimeInterval: values[4], repeats: false) { _ in application.terminate(nil) }
application.run()
