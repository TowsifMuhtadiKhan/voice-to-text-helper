import React, { useEffect, useRef, useState } from 'react';

interface SoundWaveProps {
  isListening: boolean;
  hasSpeechActivity?: boolean;
}

/**
 * SoundWave visualizer that ONLY moves when the user is actively speaking.
 * When silent or not speaking, the bars stay completely calm and still.
 */
export const SoundWave: React.FC<SoundWaveProps> = ({ isListening, hasSpeechActivity = false }) => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [barHeights, setBarHeights] = useState<number[]>([4, 4, 4, 4, 4, 4, 4]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isListening) {
      setIsSpeaking(false);
      setBarHeights([4, 4, 4, 4, 4, 4, 4]);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
      return;
    }

    // Connect to microphone via Web Audio API to detect real sound input
    let isCancelled = false;

    async function initAudio() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (isCancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioContextClass();
        audioCtxRef.current = ctx;

        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const checkVolume = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);

          // Compute average volume across frequency bins
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;

          // Sound threshold: volume > 10 means user is actively speaking into the mic
          const voiceDetected = avg > 12;

          if (voiceDetected || hasSpeechActivity) {
            setIsSpeaking(true);
            // Map frequencies to 7 bar heights (between 8px and 48px for greater prominence)
            const nextHeights = [
              Math.max(8, Math.min(34, ((dataArray[2] || avg) / 255) * 54)),
              Math.max(10, Math.min(42, ((dataArray[4] || avg) / 255) * 62)),
              Math.max(12, Math.min(46, ((dataArray[6] || avg) / 255) * 68)),
              Math.max(14, Math.min(48, ((dataArray[8] || avg) / 255) * 72)),
              Math.max(12, Math.min(46, ((dataArray[10] || avg) / 255) * 68)),
              Math.max(10, Math.min(42, ((dataArray[12] || avg) / 255) * 62)),
              Math.max(8, Math.min(34, ((dataArray[14] || avg) / 255) * 54)),
            ];
            setBarHeights(nextHeights);
          } else {
            // User is silent / not speaking -> bars remain calm
            setIsSpeaking(false);
            setBarHeights([6, 6, 6, 6, 6, 6, 6]);
          }

          animFrameRef.current = requestAnimationFrame(checkVolume);
        };

        checkVolume();
      } catch {
        // Fallback: If microphone stream cannot be inspected, use speech activity prop
        if (!isCancelled && hasSpeechActivity) {
          setIsSpeaking(true);
          setBarHeights([14, 28, 42, 48, 38, 24, 12]);
        } else {
          setIsSpeaking(false);
          setBarHeights([6, 6, 6, 6, 6, 6, 6]);
        }
      }
    }

    initAudio();

    return () => {
      isCancelled = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, [isListening]);

  // When speech activity prop changes, update if Web Audio fallback is used
  useEffect(() => {
    if (!audioCtxRef.current && isListening) {
      if (hasSpeechActivity) {
        setIsSpeaking(true);
        setBarHeights([14, 28, 42, 48, 38, 24, 12]);
      } else {
        setIsSpeaking(false);
        setBarHeights([6, 6, 6, 6, 6, 6, 6]);
      }
    }
  }, [hasSpeechActivity, isListening]);

  return (
    <div
      className={`sound-wave ${isSpeaking ? 'active-speaking' : 'silent-idle'}`}
      title={isSpeaking ? 'Voice detected' : 'Microphone active (waiting for speech)'}
    >
      {barHeights.map((h, i) => (
        <span
          key={i}
          className={`wave-bar ${isSpeaking ? 'bar-active' : 'bar-idle'}`}
          style={{ height: `${h}px` }}
        />
      ))}
    </div>
  );
};
