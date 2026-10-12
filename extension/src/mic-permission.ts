import { SELECTED_MIC_STORAGE_KEY } from "./constants";

const requestBtn = document.getElementById("requestBtn") as HTMLButtonElement;
const micSelect = document.getElementById("micSelect") as HTMLSelectElement;
const statusEl = document.getElementById("status") as HTMLElement;

function setStatus(message: string) {
  statusEl.textContent = message;
}

async function getMicrophones() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "audioinput");
}

async function refreshMicrophones() {
  micSelect.innerHTML = '<option value="">Loading microphones...</option>';

  const microphones = await getMicrophones();
  micSelect.innerHTML = "";

  if (microphones.length === 0) {
    micSelect.innerHTML = '<option value="">No microphone found</option>';
    requestBtn.disabled = true;
    setStatus("Connect a microphone and try again.");
    return;
  }

  microphones.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId || "default";
    option.textContent = device.label || `Microphone ${index + 1}`;
    micSelect.appendChild(option);
  });

  requestBtn.disabled = false;
  setStatus("Choose a microphone, then allow access.");
}

requestBtn.addEventListener("click", async () => {
  const deviceId = micSelect.value || "default";

  try {
    const audio = deviceId === "default" ? true : { deviceId: { exact: deviceId } };
    const stream = await navigator.mediaDevices.getUserMedia({ audio });

    stream.getTracks().forEach((track) => track.stop());
    localStorage.setItem(SELECTED_MIC_STORAGE_KEY, deviceId);
    await chrome.storage.local.set({ preferredMicDeviceId: deviceId });
    setStatus("Microphone access is ready. You can close this tab.");
    window.setTimeout(() => window.close(), 500);
  } catch {
    setStatus("Microphone access was not granted.");
  }
});

void refreshMicrophones();
