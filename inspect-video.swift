import AVFoundation
import Foundation
import ImageIO

guard CommandLine.arguments.count == 2 else {
    fputs("usage: inspect-video <movie.mp4>\n", stderr)
    exit(1)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let asset = AVURLAsset(url: url)
let duration = CMTimeGetSeconds(asset.duration)
guard duration.isFinite, let track = asset.tracks(withMediaType: .video).first else {
    fputs("No playable video track found\n", stderr)
    exit(1)
}
print("duration=\(String(format: "%.2f", duration))s size=\(Int(track.naturalSize.width))x\(Int(track.naturalSize.height))")
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
for second in [0.0, 15.0, 30.0, 44.0, 56.0, 66.5, 68.0, 71.0] where second < duration {
    do {
        let image = try generator.copyCGImage(at: CMTime(seconds: second, preferredTimescale: 600), actualTime: nil)
        let output = URL(fileURLWithPath: "/tmp/gta6-video-frame-\(Int(second)).png")
        guard let destination = CGImageDestinationCreateWithURL(output as CFURL, "public.png" as CFString, 1, nil) else {
            throw NSError(domain: "video-inspect", code: 1)
        }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw NSError(domain: "video-inspect", code: 2) }
        print("frame@\(Int(second))s=\(output.path)")
    } catch {
        fputs("Could not decode frame at \(second)s: \(error)\n", stderr)
        exit(1)
    }
}
