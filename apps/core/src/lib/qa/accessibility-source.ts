/** Compiled locally with the macOS SDK; no globally installed driver or Pi runtime. */
export const ACCESSIBILITY_SOURCE = String.raw`
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(message.utf8))
    exit(1)
}
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value
}
func children(_ element: AXUIElement) -> [AXUIElement] {
    return attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []
}
func label(_ element: AXUIElement) -> String {
    let title = attribute(element, kAXTitleAttribute) as? String ?? ""
    return title.isEmpty ? attribute(element, kAXDescriptionAttribute) as? String ?? "" : title
}
let args = CommandLine.arguments
guard args.count >= 3 else { fail("Expected bundle ID and operation.") }
guard AXIsProcessTrusted() else { fail("Accessibility permission is required for the DevHub process.") }
guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: args[1]).first else { fail("The selected application is not running.") }
let root = AXUIElementCreateApplication(app.processIdentifier)
AXUIElementSetMessagingTimeout(root, 2)
if args[2] == "press" {
    guard args.count == 5 else { fail("Expected control path and observed label.") }
    var target = root
    for part in args[3].split(separator: ".") {
        guard let index = Int(part) else { fail("Invalid control path.") }
        let items = children(target)
        guard index >= 0 && index < items.count else { fail("The control moved.") }
        target = items[index]
    }
    guard label(target) == args[4] else { fail("The control changed.") }
    guard AXUIElementPerformAction(target, kAXPressAction as CFString) == .success else { fail("The control could not be pressed.") }
    print("{}")
    exit(0)
}
guard args[2] == "snapshot" else { fail("Unknown operation.") }
var text: [String] = []
var controls: [[String: String]] = []
var visited = 0
func visit(_ element: AXUIElement, _ path: [Int], _ depth: Int) {
    if depth > 14 || visited > 600 { return }
    visited += 1
    let role = attribute(element, kAXRoleAttribute) as? String ?? ""
    if role == "AXSecureTextField" { return }
    let name = label(element)
    let value = attribute(element, kAXValueAttribute) as? String ?? ""
    let row = [role, name, value].filter { !$0.isEmpty }.joined(separator: " ")
    if !row.isEmpty { text.append(String(row.prefix(500))) }
    var actions: CFArray?
    AXUIElementCopyActionNames(element, &actions)
    if (actions as? [String] ?? []).contains(kAXPressAction) && !name.isEmpty && controls.count < 180 {
        controls.append(["id": path.map(String.init).joined(separator: "."), "name": name])
    }
    for (index, child) in children(element).enumerated() { visit(child, path + [index], depth + 1) }
}
visit(root, [], 0)
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let window = windows.first { row in
    (row[kCGWindowOwnerPID as String] as? Int) == Int(app.processIdentifier) &&
    (row[kCGWindowLayer as String] as? Int) == 0
}
guard let windowId = window?[kCGWindowNumber as String] as? Int else { fail("No visible application window is available.") }
let result: [String: Any] = ["text": text.joined(separator: "\n"), "controls": controls, "windowId": windowId]
guard let data = try? JSONSerialization.data(withJSONObject: result), let output = String(data: data, encoding: .utf8) else { fail("Snapshot encoding failed.") }
print(output)
`;
