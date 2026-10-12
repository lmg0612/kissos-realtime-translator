import { useEffect, useState, useRef } from "react";
import "./MicrophoneCard.css";

const STORAGE_KEY = "sett_selected_microphone_id";
const MIC_PERMISSION_GRANTED_EVENT = "sett:microphone-permission-granted";

async function hasMicrophonePermission() {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state === "granted";
  } catch {
    return false;
  }
}

async function syncSelectedDevice(deviceId: string) {
  if (!globalThis.chrome?.storage?.local) return;

  if (deviceId) {
    await chrome.storage.local.set({ preferredMicDeviceId: deviceId });
  } else {
    await chrome.storage.local.remove("preferredMicDeviceId");
  }
}

export default function MicrophoneCard() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY) || "";
  });
  const [, setVolume] = useState<number>(0);
  const [isOpen, setIsOpen] = useState(false);
  
  const dropdownRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isRefreshingRef = useRef<boolean>(false);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const getDevices = async (isInitial = false) => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;

    try {
      if (isInitial && await hasMicrophonePermission()) {
        const initialStream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
        if (initialStream) {
          initialStream.getTracks().forEach(t => t.stop());
        }
      }
      
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices.filter(device => device.kind === "audioinput");
      
      const uniqueDevices = audioInputs.filter((device, index, self) => 
        index === self.findIndex((d) => (
          d.label === device.label && d.label !== ""
        )) || device.label === ""
      );

      setDevices(uniqueDevices);
      
      if (uniqueDevices.length > 0) {
        const savedId = localStorage.getItem(STORAGE_KEY);
        const exists = uniqueDevices.some(d => d.deviceId === savedId);

        if (isInitial) {
          if (savedId && exists) {
            setSelectedDeviceId(savedId);
          } else {
            setSelectedDeviceId("");
          }
        } else {
          if (selectedDeviceId && !uniqueDevices.some(d => d.deviceId === selectedDeviceId)) {
            setSelectedDeviceId("");
            localStorage.removeItem(STORAGE_KEY);
          }
        }
      } else {
        setSelectedDeviceId("");
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        console.error("Error enumerating devices:", err);
      }
    } finally {
      setTimeout(() => {
        isRefreshingRef.current = false;
      }, 500);
    }
  };

  useEffect(() => {
    getDevices(true);
    const handleDeviceChange = () => getDevices();
    const handlePermissionGranted = () => getDevices(true);
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    window.addEventListener(MIC_PERMISSION_GRANTED_EVENT, handlePermissionGranted);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
      window.removeEventListener(MIC_PERMISSION_GRANTED_EVENT, handlePermissionGranted);
    };
  }, [selectedDeviceId]);

  const cleanup = async () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        if (audioContextRef.current.state !== "closed") {
          await audioContextRef.current.close();
        }
      } catch (e) {}
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setVolume(0);
  };

  const startVolumeMeter = async (deviceId: string) => {
    await cleanup();
    if (!deviceId) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } }
      });
      streamRef.current = stream;

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;

      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
        setVolume(sum / bufferLength);
        animationFrameRef.current = requestAnimationFrame(updateVolume);
      };

      updateVolume();
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        console.error("Error starting volume meter:", err);
      }
      setVolume(0);
    }
  };

  useEffect(() => {
    if (selectedDeviceId) {
      const timeoutId = setTimeout(() => {
        void hasMicrophonePermission().then((hasPermission) => {
          if (hasPermission) void startVolumeMeter(selectedDeviceId);
        });
      }, 100);
      return () => clearTimeout(timeoutId);
    } else {
      cleanup();
    }
  }, [selectedDeviceId]);

  const handleSelect = (id: string) => {
    setSelectedDeviceId(id);
    if (id) {
      localStorage.setItem(STORAGE_KEY, id);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    void syncSelectedDevice(id);
    setIsOpen(false);
  };

  const selectedDeviceLabel = devices.find(d => d.deviceId === selectedDeviceId)?.label || "No device";

  return (
    <div className="microphone-card">
      <header className="microphone-card__header">
        <h2 className="microphone-card__title">Microphone</h2>
      </header>
      
      <div className="microphone-card__content">
        <div className="custom-select" ref={dropdownRef}>
          <div 
            className={`custom-select__trigger ${isOpen ? "open" : ""}`}
            onClick={() => setIsOpen(!isOpen)}
          >
            <span className="custom-select__label">{selectedDeviceLabel}</span>
            <div className="custom-select__arrow" />
          </div>
          
          {isOpen && (
            <div className="custom-select__options">
              <div 
                className={`custom-select__option ${selectedDeviceId === "" ? "selected" : ""}`}
                onClick={() => handleSelect("")}
              >
                No device
              </div>
              {devices.map((device) => (
                <div 
                  key={device.deviceId} 
                  className={`custom-select__option ${selectedDeviceId === device.deviceId ? "selected" : ""}`}
                  onClick={() => handleSelect(device.deviceId)}
                >
                  {device.label || `Microphone ${device.deviceId.slice(0, 5)}`}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* <div className="volume-meter"> */}
          {/* <div className="volume-meter__label">Test Volume</div> */}
          {/* <div className="volume-meter__bar-container">
            <div 
              className="volume-meter__bar" 
              style={{ width: `${Math.min(100, (volume / 100) * 100)}%` }}
            />
          </div> */}
        {/* </div> */}
      </div>
    </div>
  );
}
