/** Kept in the server bundle so packaged installs do not need a source checkout. */
export const VISION_OCR_SOURCE = String.raw`import Foundation
import ImageIO
import Vision

let data = FileHandle.standardInput.readDataToEndOfFile()
guard !data.isEmpty && data.count <= 8_000_000,
      let source = CGImageSourceCreateWithData(data as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    FileHandle.standardError.write(Data("Invalid image\n".utf8))
    exit(64)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
do {
    try VNImageRequestHandler(cgImage: image).perform([request])
    let lines = request.results?.compactMap { $0.topCandidates(1).first?.string } ?? []
    FileHandle.standardOutput.write(Data(lines.joined(separator: "\n").utf8))
} catch {
    FileHandle.standardError.write(Data("Text recognition failed\n".utf8))
    exit(1)
}
`;
