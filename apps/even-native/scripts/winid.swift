// Prints the id of the largest ordinary window of the process with this pid.
import CoreGraphics
import Foundation
let pid = Int(CommandLine.arguments[1]) ?? 0
let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as! [[String: Any]]
var best = (id: 0, area: 0.0)
for w in list {
  guard let owner = w[kCGWindowOwnerPID as String] as? Int, owner == pid,
        let layer = w[kCGWindowLayer as String] as? Int, layer == 0,
        let b = w[kCGWindowBounds as String] as? [String: Any] else { continue }
  let area = (b["Width"] as? Double ?? 0) * (b["Height"] as? Double ?? 0)
  if area > best.area { best = (w[kCGWindowNumber as String] as! Int, area) }
}
if best.id != 0 { print(best.id) }
