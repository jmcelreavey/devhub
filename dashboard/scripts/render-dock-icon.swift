// Draw an .icns the way macOS draws an app's bundle icon (rounded tile,
// margins, shadow) and save it as a 512px PNG for setApplicationIconImage.
//   swift render-dock-icon.swift <icon.icns> <out.png>
import AppKit

let args = CommandLine.arguments
guard args.count == 3 else {
  FileHandle.standardError.write("usage: render-dock-icon.swift <icon.icns> <out.png>\n".data(using: .utf8)!)
  exit(2)
}
let fm = FileManager.default
// A fresh path each run, so IconServices has nothing cached for it.
let app = fm.temporaryDirectory.appendingPathComponent("devhub-dock-\(UUID().uuidString).app")
let resources = app.appendingPathComponent("Contents/Resources")
try fm.createDirectory(at: resources, withIntermediateDirectories: true)
defer { try? fm.removeItem(at: app) }
try fm.copyItem(at: URL(fileURLWithPath: args[1]), to: resources.appendingPathComponent("icon.icns"))
// Without a runnable executable macOS draws its "can't open" slash over the icon.
let macos = app.appendingPathComponent("Contents/MacOS")
try fm.createDirectory(at: macos, withIntermediateDirectories: true)
try fm.copyItem(at: URL(fileURLWithPath: "/usr/bin/true"), to: macos.appendingPathComponent("render"))
let plist: [String: Any] = [
  "CFBundleIdentifier": "com.devhub.dock-icon-render",
  "CFBundleIconFile": "icon.icns",
  "CFBundleExecutable": "render",
  "CFBundlePackageType": "APPL",
]
try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
  .write(to: app.appendingPathComponent("Contents/Info.plist"))

let icon = NSWorkspace.shared.icon(forFile: app.path)
let px = 512
let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
  samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
  bytesPerRow: 0, bitsPerPixel: 0)!
rep.size = NSSize(width: px, height: px)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
icon.draw(in: NSRect(x: 0, y: 0, width: px, height: px))
NSGraphicsContext.restoreGraphicsState()
try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
print("[render-dock-icon] wrote \(args[2])")
