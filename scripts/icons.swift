// Renders SF Symbols into PNG assets (tray template icons + UI icon masks) and builds the app icon.
// Usage: swift scripts/icons.swift assets
import AppKit

let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "assets")

func render(size: NSSize, scale: CGFloat, to url: URL, draw: (CGContext) -> Void) {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: Int(size.width * scale), pixelsHigh: Int(size.height * scale),
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = size
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    draw(NSGraphicsContext.current!.cgContext)
    NSGraphicsContext.restoreGraphicsState()
    try! rep.representation(using: .png, properties: [:])!.write(to: url)
}

func symbol(_ name: String, _ pointSize: CGFloat, _ weight: NSFont.Weight) -> NSImage {
    let config = NSImage.SymbolConfiguration(pointSize: pointSize, weight: weight)
        .applying(NSImage.SymbolConfiguration(paletteColors: [.black]))
    return NSImage(systemSymbolName: name, accessibilityDescription: nil)!.withSymbolConfiguration(config)!
}

func writeSymbol(_ name: String, pointSize: CGFloat, weight: NSFont.Weight = .regular, scales: [CGFloat], file: String) {
    let image = symbol(name, pointSize, weight)
    let size = NSSize(width: ceil(image.size.width), height: ceil(image.size.height))
    for scale in scales {
        let suffix = scale == 1 ? "" : "@\(Int(scale))x"
        render(size: size, scale: scale, to: out.appending(path: "\(file)\(suffix).png")) { _ in
            image.draw(in: NSRect(x: (size.width - image.size.width) / 2, y: (size.height - image.size.height) / 2,
                                  width: image.size.width, height: image.size.height))
        }
    }
}

// Menu bar (template images — macOS tints them for light/dark menu bars)
writeSymbol("timer", pointSize: 14, scales: [1, 2], file: "trayTemplate")
writeSymbol("cup.and.saucer", pointSize: 13, scales: [1, 2], file: "trayBreakTemplate")
writeSymbol("pause", pointSize: 13, weight: .medium, scales: [1, 2], file: "trayPauseTemplate")

// UI icons, used as CSS masks so they take the current text color
for (name, weight) in [
    ("play.fill", NSFont.Weight.regular), ("pause.fill", .regular), ("arrow.counterclockwise", .medium),
    ("forward.end.fill", .regular), ("chart.bar", .regular), ("chart.bar.fill", .regular),
    ("ellipsis", .bold), ("plus", .medium), ("xmark", .semibold),
] {
    writeSymbol(name, pointSize: 32, weight: weight, scales: [1], file: "icons/\(name)")
}

// App icon: a red squircle with a white progress ring
let iconset = URL(fileURLWithPath: NSTemporaryDirectory()).appending(path: "AppIcon.iconset")
try? FileManager.default.removeItem(at: iconset)
try! FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
for px in [16, 32, 64, 128, 256, 512, 1024] {
    let s = CGFloat(px) / 1024
    let draw: (CGContext) -> Void = { ctx in
        ctx.scaleBy(x: s, y: s)
        let body = CGPath(roundedRect: CGRect(x: 100, y: 100, width: 824, height: 824), cornerWidth: 185, cornerHeight: 185, transform: nil)
        ctx.saveGState()
        ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 24, color: NSColor.black.withAlphaComponent(0.25).cgColor)
        ctx.addPath(body); ctx.setFillColor(NSColor.black.cgColor); ctx.fillPath()
        ctx.restoreGState()
        ctx.addPath(body); ctx.clip()
        let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [
            NSColor(red: 1.00, green: 0.42, blue: 0.33, alpha: 1).cgColor,
            NSColor(red: 0.90, green: 0.20, blue: 0.16, alpha: 1).cgColor,
        ] as CFArray, locations: [0, 1])!
        ctx.drawLinearGradient(gradient, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])
        let c = CGPoint(x: 512, y: 512)
        ctx.setLineWidth(70); ctx.setLineCap(.round)
        ctx.setStrokeColor(NSColor.white.withAlphaComponent(0.3).cgColor)
        ctx.addArc(center: c, radius: 240, startAngle: 0, endAngle: .pi * 2, clockwise: false); ctx.strokePath()
        ctx.setStrokeColor(NSColor.white.cgColor)
        ctx.addArc(center: c, radius: 240, startAngle: .pi / 2, endAngle: .pi / 2 - .pi * 1.5, clockwise: true); ctx.strokePath()
    }
    let size = NSSize(width: px, height: px)
    if px <= 512 { render(size: size, scale: 1, to: iconset.appending(path: "icon_\(px)x\(px).png"), draw: draw) }
    if px >= 32 { render(size: size, scale: 1, to: iconset.appending(path: "icon_\(px / 2)x\(px / 2)@2x.png"), draw: draw) }
}
let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = ["-c", "icns", iconset.path, "-o", out.appending(path: "AppIcon.icns").path]
try! iconutil.run(); iconutil.waitUntilExit()
print("Assets written to \(out.path)")
