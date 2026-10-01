import AVFoundation
import AppKit

// frames <video> <out.png> <start s> <step s> <count> [perRow] [scale]
// Lays frames of a screen recording side by side, each stamped with its time.
let a = CommandLine.arguments
guard a.count >= 6 else { print("usage: frames video out start step count [perRow] [scale]"); exit(1) }
let asset = AVURLAsset(url: URL(fileURLWithPath: a[1]))
let start = Double(a[3])!, step = Double(a[4])!, count = Int(a[5])!
let perRow = a.count > 6 ? Int(a[6])! : 8
let scale = a.count > 7 ? Double(a[7])! : 0.2
let gen = AVAssetImageGenerator(asset: asset)
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero
gen.appliesPreferredTrackTransform = true
var images: [(Double, CGImage)] = []
let dur = CMTimeGetSeconds(asset.duration)
for i in 0..<count {
  let t = start + Double(i) * step
  if t > dur { break }
  if let img = try? gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil) { images.append((t, img)) }
}
guard let first = images.first else { print("no frames (duration \(dur))"); exit(1) }
let w = Int(Double(first.1.width) * scale), h = Int(Double(first.1.height) * scale)
let rows = (images.count + perRow - 1) / perRow
let gap = 4
let W = perRow * (w + gap) + gap, H = rows * (h + gap + 14) + gap
let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
let ns = NSGraphicsContext(cgContext: ctx, flipped: false)
NSGraphicsContext.current = ns
for (i, (t, img)) in images.enumerated() {
  let col = i % perRow, row = i / perRow
  let x = gap + col * (w + gap)
  let y = H - (row + 1) * (h + gap + 14)
  ctx.interpolationQuality = .high
  ctx.draw(img, in: CGRect(x: x, y: y, width: w, height: h))
  let label = String(format: "%.3fs", t) as NSString
  label.draw(at: NSPoint(x: x + 2, y: y + h + 1), withAttributes: [.font: NSFont.monospacedSystemFont(ofSize: 10, weight: .regular), .foregroundColor: NSColor.black])
}
let out = ctx.makeImage()!
let rep = NSBitmapImageRep(cgImage: out)
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: a[2]))
print("wrote \(a[2]) \(W)x\(H), \(images.count) frames, video \(String(format: "%.2f", dur))s")
