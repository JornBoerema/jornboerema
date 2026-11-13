import CoreGraphics
import Foundation
let name = CommandLine.arguments[1]
let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
for w in list {
  if let owner = w[kCGWindowOwnerName as String] as? String, owner == name,
     let layer = w[kCGWindowLayer as String] as? Int, layer == 0,
     let b = w[kCGWindowBounds as String] as? [String: Any], (b["Width"] as? Double ?? 0) > 400 {
    print(w[kCGWindowNumber as String] as! Int); break
  }
}
