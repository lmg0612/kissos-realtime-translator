
export function float32ToWav(buffer, sampleRate) {
    const frameCount = buffer.length;
    const wavBuffer = new ArrayBuffer(44 + frameCount * 2);
    const view = new DataView(wavBuffer);

    const writeString = (offset, string) => {
        for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + frameCount * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, frameCount * 2, true);

    for (let i = 0; i < frameCount; i++) {
        let s = Math.max(-1, Math.min(1, buffer[i]));
        view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return new Blob([view], { type: 'audio/wav' });
}

// 2. HTML 목록에 오디오 추가하는 함수
export function addToPlaylist(float32Array, label) {
    console.log("Adding audio to playlist:");
    const list = document.getElementById('audio-list');
    const blob = float32ToWav(float32Array, 16000);
    const url = URL.createObjectURL(blob);

    const li = document.createElement('li');
    li.className = 'audio-item';
    
    const now = new Date().toLocaleTimeString();
    li.innerHTML = `
        <span class="time-tag">[${label}] ${now}</span>
        <audio src="${url}" controls></audio>
        <a href="${url}" download="capture_${label}.wav">저장</a>
    `;
    
    // 최신 항목이 위로 오게 추가
    list.insertBefore(li, list.firstChild);
}