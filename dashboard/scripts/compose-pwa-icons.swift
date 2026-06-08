#!/usr/bin/env swift
/**
 Flattens `brand-bottle-photo-transparent.png` onto the default Graphite dark
 page background (`#111416` from `app/globals.css`) and writes `icon-*.png`
 sizes used by `metadata.icons` and `manifest.webmanifest`.
 */
import AppKit
import Foundation

let args = CommandLine.arguments.dropFirst()
let publicDir: String
if let first = args.first, !first.isEmpty {
  publicDir = (first as NSString).expandingTildeInPath
} else {
  publicDir = (URL(fileURLWithPath: FileManager.default.currentDirectoryPath) as NSURL)
    .appendingPathComponent("public", isDirectory: true)!.path
}

let sourcePath = (publicDir as NSString).appendingPathComponent("brand-bottle-photo-transparent.png")
let sourceURL = URL(fileURLWithPath: sourcePath)

guard let source = NSImage(contentsOf: sourceURL) else {
  fputs("compose-pwa-icons: could not read \(sourcePath)\n", stderr)
  exit(1)
}

let bg = NSColor(srgbRed: 0x11 / 255, green: 0x14 / 255, blue: 0x16 / 255, alpha: 1)

func writeIcon(side: Int) throws {
  let size = NSSize(width: side, height: side)
  let out = NSImage(size: size)
  out.lockFocus()
  bg.setFill()
  NSBezierPath(rect: NSRect(origin: .zero, size: size)).fill()

  let srcSize = source.size
  let from = NSRect(origin: .zero, size: srcSize)
  let to = NSRect(origin: .zero, size: size)
  source.draw(in: to, from: from, operation: .sourceOver, fraction: 1.0)
  out.unlockFocus()

  guard let tiff = out.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else {
    throw NSError(domain: "compose-pwa-icons", code: 1, userInfo: [NSLocalizedDescriptionKey: "bitmap"])
  }
  guard let data = rep.representation(using: .png, properties: [:]) else {
    throw NSError(domain: "compose-pwa-icons", code: 2, userInfo: [NSLocalizedDescriptionKey: "png"])
  }
  let outPath = (publicDir as NSString).appendingPathComponent("icon-\(side).png")
  try data.write(to: URL(fileURLWithPath: outPath))
}

do {
  for side in [32, 180, 192, 512] {
    try writeIcon(side: side)
  }
} catch {
  fputs("compose-pwa-icons: \(error)\n", stderr)
  exit(1)
}

print("compose-pwa-icons: wrote icon-{32,180,192,512}.png → \(publicDir)")
