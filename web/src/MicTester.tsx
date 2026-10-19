import React, { useEffect, useRef, useState } from 'react';

interface MicTesterProps {
  selectedDeviceId?: string;
}

export const MicTester: React.FC<MicTesterProps> = ({ selectedDeviceId }) => {
  const [isTesting, setIsTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [deviceName, setDeviceName] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'testing' | 'blocked' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const startTest = async () => {
    stopTest();
    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      const track = stream.getAudioTracks()[0];
      setDeviceName(track?.label || 'Default Microphone');
      setStatus('testing');
      setIsTesting(true);

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateMeter = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        // Normalize 0 to 100
        const percentage = Math.min(100, Math.round((avg / 128) * 100));
        setLevel(percentage);
        animFrameRef.current = requestAnimationFrame(updateMeter);
      };

      updateMeter();
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setStatus('blocked');
        setErrorMessage('Microphone access blocked. Please enable permission in browser settings.');
      } else {
        setStatus('error');
        setErrorMessage(err.message || 'Could not access microphone.');
      }
      setIsTesting(false);
    }
  };

  const stopTest = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setIsTesting(false);
    setLevel(0);
    if (status === 'testing') setStatus('idle');
  };

  useEffect(() => {
    return () => {
      stopTest();
    };
  }, []);

  return (
    <div className="mic-tester-card">
      <div className="mic-tester-header">
        <span className="mic-tester-title">Microphone Hardware Test</span>
        <button
          type="button"
          className={`mic-test-btn ${isTesting ? 'testing' : ''}`}
          onClick={isTesting ? stopTest : startTest}
        >
          {isTesting ? 'Stop Test' : 'Start Mic Test'}
        </button>
      </div>

      {deviceName && (
        <div className="mic-device-name">
          <span>Active Device:</span> {deviceName}
        </div>
      )}

      {/* Meter Bar */}
      <div className="mic-level-meter-wrap">
        <div
          className={`mic-level-meter-fill ${level > 50 ? 'high' : level > 15 ? 'active' : ''}`}
          style={{ width: `${level}%` }}
        />
      </div>

      <div className="mic-level-label-row">
        <span>Signal Level: {level}%</span>
        <span className={level > 10 ? 'signal-detected' : 'signal-idle'}>
          {isTesting ? (level > 10 ? '✓ Audio Detected' : 'Speak into mic...') : 'Ready to test'}
        </span>
      </div>

      {status === 'blocked' && (
        <div className="mic-test-error">
          ⚠️ {errorMessage}
        </div>
      )}
    </div>
  );
};
