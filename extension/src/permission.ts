const askBtn = document.getElementById('ask-btn') as HTMLButtonElement;
const successBox = document.getElementById('success-box') as HTMLDivElement;
const promptDesc = document.getElementById('prompt-desc') as HTMLParagraphElement;

async function requestMicrophone(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Keep tracks alive briefly then stop
    stream.getTracks().forEach((track) => track.stop());

    askBtn.style.display = 'none';
    promptDesc.style.display = 'none';
    successBox.style.display = 'block';

    setTimeout(() => {
      window.close();
    }, 1500);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    promptDesc.textContent = `Microphone access was denied or not detected (${message}). Please click the lock or camera icon in the address bar and select "Allow".`;
    promptDesc.style.color = '#ef4444';
  }
}

askBtn.addEventListener('click', requestMicrophone);

// Automatically trigger permission prompt on page load
requestMicrophone();
