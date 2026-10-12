import { addToPlaylist } from "./audio-utils"
import { setupVAD } from "./setup-vad"


const vad = await setupVAD({
  sendToServer: (audio: Float32Array, isLong: boolean, isEnded: boolean) => {
    addToPlaylist(audio, "VAD")
  }
})


const vadToggle = document.getElementById('vadToggle') as HTMLButtonElement
let isRunning: boolean = false

vadToggle.addEventListener('click', async (): Promise<void> => {
	vadToggle.disabled = true;

	try {
		if (!isRunning) {
			await vad.start()
			isRunning = true;
			vadToggle.innerText = "Weave is listening..."
			vadToggle.classList.add('active')

		} else {
			await vad.pause()
			isRunning = false
			vadToggle.innerText = "Weave is paused..."
			vadToggle.classList.remove('active')
		}
	} catch (error) {
			console.error("VAD 제어 중 오류 발생:", error)
	} finally {
			vadToggle.disabled = false
	}
})