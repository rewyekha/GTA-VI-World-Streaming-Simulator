import AVFoundation
import CoreGraphics
import CoreVideo
import Foundation
import ImageIO

func fail(_ message: String) -> Never {
    fputs("video encoder: \(message)\n", stderr)
    exit(1)
}

guard CommandLine.arguments.count == 4 else {
    fail("usage: frames-to-mp4 <jpeg-frame-dir> <output.mp4> <fps>")
}
let frameDirectory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
guard let fps = Int32(CommandLine.arguments[3]), fps > 0 else { fail("invalid frame rate") }
let files: [URL]
do {
    files = try FileManager.default.contentsOfDirectory(at: frameDirectory, includingPropertiesForKeys: nil)
        .filter { $0.pathExtension == "jpg" }
        .sorted { $0.lastPathComponent < $1.lastPathComponent }
} catch { fail("cannot list captured frames: \(error)") }
guard files.count >= Int(fps) else { fail("too few captured frames") }

let width = 1280
let height = 720
try? FileManager.default.removeItem(at: outputURL)
let writer: AVAssetWriter
do {
    writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
} catch { fail("cannot create MP4 writer: \(error)") }
let compressionProperties: [String: Any] = [
    AVVideoAverageBitRateKey: 4_000_000,
    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
    AVVideoExpectedSourceFrameRateKey: Int(fps),
    AVVideoMaxKeyFrameIntervalKey: Int(fps),
]
let settings: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: compressionProperties,
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let attributes: [String: Any] = [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height,
    kCVPixelBufferCGImageCompatibilityKey as String: true,
    kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
]
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: attributes)
guard writer.canAdd(input) else { fail("H.264 writer input is unavailable") }
writer.add(input)
guard writer.startWriting() else { fail("cannot start H.264 writer: \(writer.error?.localizedDescription ?? "unknown error")") }
writer.startSession(atSourceTime: .zero)
let colorSpace = CGColorSpaceCreateDeviceRGB()

for (index, url) in files.enumerated() {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        fail("cannot decode \(url.lastPathComponent)")
    }
    guard image.width == width, image.height == height else {
        fail("unexpected frame size \(image.width)x\(image.height)")
    }
    while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.002) }
    var pixelBuffer: CVPixelBuffer?
    guard let pool = adaptor.pixelBufferPool,
          CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &pixelBuffer) == kCVReturnSuccess,
          let buffer = pixelBuffer else { fail("cannot allocate encoder pixel buffer") }
    CVPixelBufferLockBaseAddress(buffer, [])
    guard let base = CVPixelBufferGetBaseAddress(buffer),
          let context = CGContext(data: base, width: width, height: height, bitsPerComponent: 8,
                                 bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: colorSpace,
                                 bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue) else {
        CVPixelBufferUnlockBaseAddress(buffer, [])
        fail("cannot create pixel context")
    }
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    CVPixelBufferUnlockBaseAddress(buffer, [])
    let timestamp = CMTime(value: Int64(index), timescale: fps)
    guard adaptor.append(buffer, withPresentationTime: timestamp) else {
        fail("frame \(index) was rejected: \(writer.error?.localizedDescription ?? "unknown error")")
    }
}

input.markAsFinished()
let finished = DispatchSemaphore(value: 0)
writer.finishWriting { finished.signal() }
finished.wait()
guard writer.status == .completed else { fail("MP4 finalization failed: \(writer.error?.localizedDescription ?? "unknown error")") }
print("Encoded \(files.count) frames at \(fps) FPS, \(files.count / Int(fps))s, 1280x720 H.264")
