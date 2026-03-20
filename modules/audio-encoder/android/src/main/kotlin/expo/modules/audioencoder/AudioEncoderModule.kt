package expo.modules.audioencoder

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.typedarray.TypedArray
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors

class AudioEncoderModule : Module() {
  private val executor = Executors.newSingleThreadExecutor()

  private var encoder: MediaCodec? = null
  private var muxer: MediaMuxer? = null
  private var audioTrackIndex = -1
  private var muxerStarted = false
  private var presentationTimeUs = 0L
  private var sampleRate = 44100
  private var totalSamples = 0L
  private var encodingError: Throwable? = null

  override fun definition() = ModuleDefinition {
    Name("AudioEncoder")

    Function("startEncoding") { filePath: String, rate: Double ->
      sampleRate = rate.toInt()
      presentationTimeUs = 0L
      totalSamples = 0L
      encodingError = null

      val format = MediaFormat.createAudioFormat("audio/mp4a-latm", sampleRate, 1).apply {
        setInteger(MediaFormat.KEY_BIT_RATE, 128_000)
        setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
        setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384)
      }
      encoder = MediaCodec.createEncoderByType("audio/mp4a-latm").also { codec ->
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        codec.start()
      }
      muxer = MediaMuxer(filePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      audioTrackIndex = -1
      muxerStarted = false
    }

    // Synchronous Function so TypedArray is accessed on the JS thread (safe).
    // Encoding is dispatched to the executor (fire-and-forget).
    Function("encodeChunk") { samples: TypedArray ->
      val floatBuf = samples.toDirectBuffer().order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
      val floats = FloatArray(floatBuf.remaining()).also { floatBuf.get(it) }
      executor.execute {
        try { encodeFloats(floats) }
        catch (e: Throwable) { encodingError = e }
      }
    }

    AsyncFunction("stopEncoding") { ->
      executor.submit<Double> {
        val chunkError = encodingError
        if (chunkError != null) {
          throw RuntimeException("encodeChunk failed: ${chunkError.message}", chunkError)
        }
        signalEndOfStream()
        drainEncoder(endOfStream = true)
        muxer?.stop(); muxer?.release(); muxer = null
        encoder?.stop(); encoder?.release(); encoder = null
        muxerStarted = false; audioTrackIndex = -1
        encodingError = null
        totalSamples.toDouble() / sampleRate * 1000.0
      }.get()
    }
  }

  private fun encodeFloats(floats: FloatArray) {
    val codec = encoder ?: throw IllegalStateException("encodeFloats: encoder is null")
    val pcm = floatToShortBytes(floats)
    var offset = 0
    while (offset < pcm.size) {
      drainEncoder(endOfStream = false)
      val idx = codec.dequeueInputBuffer(10_000L)
      if (idx < 0) continue
      val buf = codec.getInputBuffer(idx) ?: continue
      buf.clear()
      val toWrite = minOf(buf.capacity(), pcm.size - offset)
      buf.put(pcm, offset, toWrite)
      val samplesInBuffer = toWrite / 2
      codec.queueInputBuffer(idx, 0, toWrite, presentationTimeUs, 0)
      presentationTimeUs += samplesInBuffer * 1_000_000L / sampleRate
      totalSamples += samplesInBuffer
      offset += toWrite
    }
  }

  private fun signalEndOfStream() {
    val codec = encoder ?: return
    val idx = codec.dequeueInputBuffer(100_000L)
    if (idx >= 0) {
      codec.queueInputBuffer(idx, 0, 0, presentationTimeUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
    }
  }

  private fun drainEncoder(endOfStream: Boolean) {
    val codec = encoder ?: return
    val info = MediaCodec.BufferInfo()
    while (true) {
      when (val idx = codec.dequeueOutputBuffer(info, 10_000L)) {
        MediaCodec.INFO_TRY_AGAIN_LATER -> { if (!endOfStream) return }
        MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          audioTrackIndex = muxer!!.addTrack(codec.outputFormat)
          muxer!!.start()
          muxerStarted = true
        }
        else -> if (idx >= 0) {
          val buf = codec.getOutputBuffer(idx)!!
          val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
          if (!isConfig && muxerStarted && info.size > 0) {
            buf.position(info.offset)
            buf.limit(info.offset + info.size)
            muxer!!.writeSampleData(audioTrackIndex, buf, info)
          }
          codec.releaseOutputBuffer(idx, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
        }
      }
    }
  }

  private fun floatToShortBytes(samples: FloatArray): ByteArray {
    val out = ByteArray(samples.size * 2)
    val buf = ByteBuffer.wrap(out).order(ByteOrder.LITTLE_ENDIAN)
    for (s in samples) buf.putShort((s.coerceIn(-1f, 1f) * 32767f).toInt().toShort())
    return out
  }
}
