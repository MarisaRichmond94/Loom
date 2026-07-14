import AVFoundation
import Foundation

// Loom chapter-narration helper. Synthesizes a chapter's plain text offline
// with a named macOS system voice (e.g. "Tom (Enhanced)"), writing a CAF audio
// file plus a per-word timing JSON derived from the synthesizer's own
// willSpeakRange callbacks — so the highlight in read mode is driven by exact
// engine timings, not a forced alignment. Compiled on demand by
// scripts/ensure-narrate.mjs; invoked from src/lib/narration/generate.ts.
//
// usage: narrate <voiceName> <input.txt> <out.caf> <out.json>
//        narrate --list        # print available voices

let args = CommandLine.arguments

func die(_ msg: String, _ code: Int32) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(code)
}

func listVoices() {
    for v in AVSpeechSynthesisVoice.speechVoices().sorted(by: { $0.name < $1.name }) {
        let q = v.quality == .premium ? "premium" : (v.quality == .enhanced ? "enhanced" : "default")
        print("  \(v.name) [\(v.identifier)] \(v.language) \(q)")
    }
}

if args.count == 2 && args[1] == "--list" { listVoices(); exit(0) }
guard args.count >= 5 else { die("usage: narrate <voiceName> <input.txt> <out.caf> <out.json>  (or --list)", 2) }

let voiceName = args[1]
let inputPath = args[2]
let outAudioPath = args[3]
let outTimingPath = args[4]

guard let text = try? String(contentsOfFile: inputPath, encoding: .utf8) else { die("cannot read \(inputPath)", 2) }

guard let voice = AVSpeechSynthesisVoice.speechVoices().first(where: { $0.name == voiceName }) else {
    FileHandle.standardError.write("voice not found: \(voiceName). Available:\n".data(using: .utf8)!)
    listVoices()
    exit(3)
}

final class Recorder: NSObject, AVSpeechSynthesizerDelegate {
    var words: [[String: Any]] = []
    var frames: Int64 = 0
    var sampleRate: Double = 22050
    let full: NSString
    init(_ s: String) { full = s as NSString }

    func speechSynthesizer(_ s: AVSpeechSynthesizer,
                           willSpeakRangeOfSpeechString characterRange: NSRange,
                           utterance: AVSpeechUtterance) {
        let timeMs = Int((Double(frames) / sampleRate) * 1000.0)
        words.append([
            "charStart": characterRange.location,
            "charLen": characterRange.length,
            "timeMs": timeMs,
            "word": full.substring(with: characterRange),
        ])
    }
}

let synth = AVSpeechSynthesizer()
let rec = Recorder(text)
synth.delegate = rec

let utt = AVSpeechUtterance(string: text)
utt.voice = voice

var audioFile: AVAudioFile?
var done = false

synth.write(utt) { (buffer: AVAudioBuffer) in
    guard let pcm = buffer as? AVAudioPCMBuffer else { return }
    if pcm.frameLength == 0 { done = true; return }   // terminal empty buffer
    if audioFile == nil {
        rec.sampleRate = pcm.format.sampleRate
        audioFile = try? AVAudioFile(forWriting: URL(fileURLWithPath: outAudioPath),
                                     settings: pcm.format.settings,
                                     commonFormat: pcm.format.commonFormat,
                                     interleaved: pcm.format.isInterleaved)
    }
    try? audioFile?.write(from: pcm)
    rec.frames += Int64(pcm.frameLength)
}

let start = Date()
while !done && Date().timeIntervalSince(start) < 180 {
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05))
}

let payload: [String: Any] = ["sampleRate": rec.sampleRate, "frames": rec.frames, "words": rec.words]
let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted])
try data.write(to: URL(fileURLWithPath: outTimingPath))

let secs = Double(rec.frames) / rec.sampleRate
FileHandle.standardError.write(
    "done=\(done) words=\(rec.words.count) frames=\(rec.frames) rate=\(Int(rec.sampleRate)) dur=\(String(format: "%.1f", secs))s\n"
        .data(using: .utf8)!)
