import { MicVAD } from "@ricky0123/vad-web";
import Denque from "denque";
import { SELECTED_MIC_STORAGE_KEY } from "./constants";

interface VADCallbacks {
  sendToServer: (audio: Float32Array, end: boolean) => void;
}

function defaultAudioConstraints(): MediaStreamConstraints {
  return {
    audio: {
      channelCount: 1,
      echoCancellation: true,
      autoGainControl: true,
      noiseSuppression: true,
    },
  };
}

async function getPreferredMicDeviceId() {
  const localDeviceId = localStorage.getItem(SELECTED_MIC_STORAGE_KEY);
  if (localDeviceId) return localDeviceId;

  const response = await chrome.runtime.sendMessage({
    type: "STORAGE_GET",
    keys: ["preferredMicDeviceId"],
  });
  if (response?.success === false) {
    throw new Error(response.error || "Failed to read preferred microphone.");
  }
  return response?.preferredMicDeviceId as string | undefined;
}

async function getPreferredAudioConstraints(): Promise<MediaStreamConstraints> {
  const deviceId = await getPreferredMicDeviceId();
  const constraints = defaultAudioConstraints();

  if (
    constraints.audio &&
    typeof constraints.audio === "object" &&
    deviceId &&
    deviceId !== "default"
  ) {
    constraints.audio.deviceId = { exact: deviceId };
  }

  return constraints;
}

async function getPreferredStream() {
  const constraints = await getPreferredAudioConstraints();

  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    const audio = constraints.audio;
    if (audio && typeof audio === "object" && "deviceId" in audio) {
      console.warn("Preferred microphone unavailable. Falling back to default microphone.", error);
      return navigator.mediaDevices.getUserMedia(defaultAudioConstraints());
    }
    throw error;
  }
}

export const setupVAD = async (callbacks: VADCallbacks) => {
  const libPath = chrome.runtime.getURL("lib/")
  const frameSize = 1536 
  const framePerChunk = 30 // 2.88초
  const framePerPreSpeechPad = 8 // 약 8개 프레임이 0.8초를 구성
  const initialPointer = frameSize * framePerPreSpeechPad // audioBuffer의 초기 포인터를 8프레임 뒤로 설정

  const chunkSize = frameSize * framePerChunk
  const sec3 = initialPointer + chunkSize
  const audioBuffer = new Float32Array(initialPointer + (frameSize * framePerChunk * 3))

  // define preSpeechPadDeque
  const preSpeechPadDeque = new Denque() // 0.8초의 pre-speech 패딩을 위해 순환버퍼를 정의
  const preSpeechPadArray = audioBuffer.subarray(0, initialPointer)

  // state management
  let currentWritePointer = initialPointer
  let currentStartPointer = 0
  let preSpeechWritePointer = 0
  let recording = false
  // setup silero VAD
  return await MicVAD.new({
    onFrameProcessed: (_, frame) => {
      if (recording) {
        audioBuffer.set(frame, currentWritePointer)
        currentWritePointer += frame.length

        if (currentWritePointer == sec3) {
          callbacks.sendToServer(audioBuffer.slice(currentStartPointer, currentWritePointer), false) 
          currentStartPointer = initialPointer
          currentWritePointer = initialPointer
        }

      } else {
        if (preSpeechPadDeque.length >= framePerPreSpeechPad) preSpeechPadDeque.shift()
        preSpeechPadDeque.push(frame)
      }
    },
    onVADMisfire: () => {
      const misRecordedArray = audioBuffer.subarray(initialPointer, currentWritePointer)
      for (let i = 0; i < misRecordedArray.length; i += frameSize) {
        const frame = misRecordedArray.slice(i, i + frameSize)
        if (preSpeechPadDeque.length >= framePerPreSpeechPad) preSpeechPadDeque.shift()
        preSpeechPadDeque.push(frame)
      }

      currentStartPointer = 0
      currentWritePointer = initialPointer
      preSpeechWritePointer = 0
      recording = false
    },
    onSpeechRealStart: () => {
      currentStartPointer = initialPointer - preSpeechPadDeque.length * frameSize
      while (preSpeechPadDeque.length > 0) {
        const frame = preSpeechPadDeque.shift()
        preSpeechPadArray.set(frame, currentStartPointer + preSpeechWritePointer)
        preSpeechWritePointer += frame.length
      }
    },
    onSpeechStart: () => {
      recording = true;
    },
        onSpeechEnd: (_) => {
      callbacks.sendToServer(audioBuffer.slice(currentStartPointer, currentWritePointer), true)
      currentStartPointer = 0
      currentWritePointer = initialPointer
      preSpeechWritePointer = 0
      recording = false
    },
    startOnLoad: false,
    baseAssetPath: libPath,
    onnxWASMBasePath: libPath,
    getStream: getPreferredStream,
    resumeStream: getPreferredStream,
  });

  
};
