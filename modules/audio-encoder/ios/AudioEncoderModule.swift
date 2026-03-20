import ExpoModulesCore
import AudioToolbox

public class AudioEncoderModule: Module {
  private var extFile: ExtAudioFileRef?
  private let encoderQueue = DispatchQueue(label: "net.tai2.voicemirror.encoder", qos: .userInitiated)
  private var sampleCount: Int64 = 0
  private var encoderSampleRate: Double = 44100.0

  public func definition() -> ModuleDefinition {
    Name("AudioEncoder")

    Function("startEncoding") { (filePath: String, sampleRate: Double) in
      self.encoderSampleRate = sampleRate
      self.sampleCount = 0

      var outputFormat = AudioStreamBasicDescription(
        mSampleRate: sampleRate,
        mFormatID: kAudioFormatMPEG4AAC,
        mFormatFlags: 0,
        mBytesPerPacket: 0,
        mFramesPerPacket: 1024,
        mBytesPerFrame: 0,
        mChannelsPerFrame: 1,
        mBitsPerChannel: 0,
        mReserved: 0
      )

      let url = URL(fileURLWithPath: filePath) as CFURL
      var ref: ExtAudioFileRef?
      let createErr = ExtAudioFileCreateWithURL(
        url,
        kAudioFileM4AType,
        &outputFormat,
        nil,
        AudioFileFlags.eraseFile.rawValue,
        &ref
      )
      guard createErr == noErr, let file = ref else {
        throw EncoderException("ExtAudioFileCreateWithURL failed: \(createErr)")
      }

      var clientFormat = AudioStreamBasicDescription(
        mSampleRate: sampleRate,
        mFormatID: kAudioFormatLinearPCM,
        mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked | kAudioFormatFlagsNativeEndian,
        mBytesPerPacket: 4,
        mFramesPerPacket: 1,
        mBytesPerFrame: 4,
        mChannelsPerFrame: 1,
        mBitsPerChannel: 32,
        mReserved: 0
      )
      let propErr = ExtAudioFileSetProperty(
        file,
        kExtAudioFileProperty_ClientDataFormat,
        UInt32(MemoryLayout<AudioStreamBasicDescription>.size),
        &clientFormat
      )
      guard propErr == noErr else {
        ExtAudioFileDispose(file)
        throw EncoderException("SetProperty ClientDataFormat failed: \(propErr)")
      }

      self.extFile = file
    }

    // Use synchronous Function so TypedArray property access happens on the JS thread.
    // The actual encoding is dispatched async to encoderQueue (fire-and-forget).
    Function("encodeChunk") { (samples: TypedArray) in
      guard samples.kind == .Float32Array else { return }
      let frameCount = samples.length
      let rawPtr = samples.rawPointer.bindMemory(to: Float.self, capacity: frameCount)
      let floats = Array(UnsafeBufferPointer(start: rawPtr, count: frameCount))
      self.encoderQueue.async {
        guard let file = self.extFile else { return }
        let fc = UInt32(frameCount)
        floats.withUnsafeBufferPointer { ptr in
          var bufferList = AudioBufferList(
            mNumberBuffers: 1,
            mBuffers: AudioBuffer(
              mNumberChannels: 1,
              mDataByteSize: fc * 4,
              mData: UnsafeMutableRawPointer(mutating: ptr.baseAddress!)
            )
          )
          ExtAudioFileWrite(file, fc, &bufferList)
        }
        self.sampleCount += Int64(frameCount)
      }
    }

    // AsyncFunction runs on a background thread, so encoderQueue.sync is safe (no deadlock).
    AsyncFunction("stopEncoding") { () -> Double in
      var thrownError: Error?
      var durationMs = 0.0
      self.encoderQueue.sync {
        guard let file = self.extFile else {
          thrownError = EncoderException("No encoder open")
          return
        }
        let err = ExtAudioFileDispose(file)
        self.extFile = nil
        if err != noErr {
          thrownError = EncoderException("ExtAudioFileDispose failed: \(err)")
        } else {
          durationMs = Double(self.sampleCount) / self.encoderSampleRate * 1000.0
        }
      }
      if let error = thrownError { throw error }
      return durationMs
    }
  }
}

class EncoderException: Exception, @unchecked Sendable {
  private let msg: String
  init(_ msg: String) {
    self.msg = msg
    super.init()
  }
  override var reason: String { msg }
}
