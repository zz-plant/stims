// The "other app" for the latency runs: plays short tone bursts through the
// default output device and logs when each one is presented, on the wall clock
// the page shares. Device latency is added to estimate when it leaves the speaker.
//
//   tools/bin/burst [--count 40] [--interval 0.5] [--ms 20] [--amp 0.01] --out bursts.jsonl
import CoreAudio
import Foundation

func argument(_ name: String, _ fallback: String) -> String {
  guard let index = CommandLine.arguments.firstIndex(of: name),
    index + 1 < CommandLine.arguments.count
  else { return fallback }
  return CommandLine.arguments[index + 1]
}

let count = Int(argument("--count", "40"))!
let interval = Double(argument("--interval", "0.5"))!
let burstMs = Double(argument("--ms", "20"))!
let amplitude = Float(argument("--amp", "0.01"))!
let outPath = argument("--out", "bursts.jsonl")

func address(_ selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal)
  -> AudioObjectPropertyAddress
{
  AudioObjectPropertyAddress(
    mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}

func read<T>(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector, _ fallback: T,
  scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> T
{
  var value = fallback
  var size = UInt32(MemoryLayout<T>.size)
  var where_ = address(selector, scope: scope)
  AudioObjectGetPropertyData(object, &where_, 0, nil, &size, &value)
  return value
}

let device: AudioDeviceID = read(
  AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultOutputDevice, AudioDeviceID(0))
let rate: Float64 = read(device, kAudioDevicePropertyNominalSampleRate, 48000.0)
let deviceLatency: UInt32 = read(device, kAudioDevicePropertyLatency, UInt32(0), scope: kAudioObjectPropertyScopeOutput)
let safetyOffset: UInt32 = read(device, kAudioDevicePropertySafetyOffset, UInt32(0), scope: kAudioObjectPropertyScopeOutput)
let bufferFrames: UInt32 = read(device, kAudioDevicePropertyBufferFrameSize, UInt32(0))

var streamLatency: UInt32 = 0
do {
  var size: UInt32 = 0
  var where_ = address(kAudioDevicePropertyStreams, scope: kAudioObjectPropertyScopeOutput)
  AudioObjectGetPropertyDataSize(device, &where_, 0, nil, &size)
  var streams = [AudioStreamID](repeating: 0, count: Int(size) / MemoryLayout<AudioStreamID>.size)
  AudioObjectGetPropertyData(device, &where_, 0, nil, &size, &streams)
  if let first = streams.first { streamLatency = read(first, kAudioStreamPropertyLatency, UInt32(0)) }
}

let speakerDelayMs = Double(deviceLatency + streamLatency) / rate * 1000
FileManager.default.createFile(atPath: outPath, contents: nil)
let out = FileHandle(forWritingAtPath: outPath)!
func log(_ line: String) { out.write((line + "\n").data(using: .utf8)!) }
log(
  "{\"kind\":\"device\",\"rate\":\(rate),\"deviceLatency\":\(deviceLatency),\"streamLatency\":\(streamLatency),\"safetyOffset\":\(safetyOffset),\"bufferFrames\":\(bufferFrames),\"speakerDelayMs\":\(speakerDelayMs)}"
)

let burstFrames = Int(burstMs / 1000 * rate)
let intervalFrames = Int(interval * rate)
var frameCursor = 0
var nextBurstAt = Int(rate)  // one second of silence first
var burstsStarted = 0
let lock = NSLock()
var pending: [(index: Int, hostTime: UInt64)] = []
var finished = false

var procID: AudioDeviceIOProcID?
let status = AudioDeviceCreateIOProcIDWithBlock(&procID, device, nil) {
  _, _, _, outData, outTime in
  let buffers = UnsafeMutableAudioBufferListPointer(outData)
  guard let first = buffers.first else { return }
  let channels = Int(first.mNumberChannels)
  let frames = Int(first.mDataByteSize) / MemoryLayout<Float32>.size / max(channels, 1)
  let samples = first.mData!.assumingMemoryBound(to: Float32.self)
  let hostPerSecond = 1e9 / Double(AudioConvertHostTimeToNanos(1_000_000)) * 1_000_000
  for frame in 0..<frames {
    let position = frameCursor + frame
    var value: Float32 = 0
    if burstsStarted < count || position < nextBurstAt - intervalFrames + burstFrames {
      if position >= nextBurstAt && burstsStarted < count {
        let offsetSeconds = Double(frame) / rate
        lock.lock()
        pending.append((burstsStarted, outTime.pointee.mHostTime + UInt64(offsetSeconds * hostPerSecond)))
        lock.unlock()
        burstsStarted += 1
        nextBurstAt += intervalFrames
      }
      let sinceStart = position - (nextBurstAt - intervalFrames)
      if burstsStarted > 0 && sinceStart >= 0 && sinceStart < burstFrames {
        value = amplitude * Float32(sin(2 * Double.pi * 1000 * Double(sinceStart) / rate))
      }
    }
    for channel in 0..<channels { samples[frame * channels + channel] = value }
  }
  frameCursor += frames
  if burstsStarted >= count && frameCursor > nextBurstAt { finished = true }
}
guard status == 0, let proc = procID else { fatalError("no IOProc: \(status)") }
AudioDeviceStart(device, proc)

func drain() {
  lock.lock()
  let items = pending
  pending = []
  lock.unlock()
  for item in items {
    let nowNs = Double(AudioConvertHostTimeToNanos(AudioGetCurrentHostTime()))
    let wallNow = Date().timeIntervalSince1970 * 1000
    let presented = wallNow - (nowNs - Double(AudioConvertHostTimeToNanos(item.hostTime))) / 1e6
    log("{\"kind\":\"burst\",\"index\":\(item.index),\"presentedAt\":\(presented),\"speakerAt\":\(presented + speakerDelayMs)}")
  }
}
while !finished {
  Thread.sleep(forTimeInterval: 0.02)
  drain()
}
drain()
AudioDeviceStop(device, proc)
AudioDeviceDestroyIOProcID(device, proc)
