"use client";

import { useRef, useState, useCallback } from "react";

interface UseGeminiVoiceOptions {
  systemPrompt: string;
  onTranscript: (text: string, role: "user" | "assistant") => void;
  onEnd: () => void;
}

export function useGeminiVoice({ systemPrompt, onTranscript, onEnd }: UseGeminiVoiceOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // ── Gapless scheduled playback system ──
  // Instead of playing chunks with onended callbacks (causes gaps),
  // we schedule each chunk at an exact time using AudioContext.currentTime
  const nextPlayTimeRef = useRef(0);
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  // ── Stop all playback immediately (for barge-in/interruption) ──
  const stopPlayback = useCallback(() => {
    // Stop all scheduled sources
    for (const src of scheduledSourcesRef.current) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    scheduledSourcesRef.current = [];
    nextPlayTimeRef.current = 0;
  }, []);

  // ── Schedule audio chunk for gapless playback ──
  const queueAudio = useCallback((base64Data: string) => {
    const ctx = playContextRef.current;
    if (!ctx) return;

    try {
      const binaryStr = atob(base64Data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      // Convert PCM int16 → float32
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }

      // Create audio buffer
      const buffer = ctx.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);

      // Schedule it at the exact next time slot (gapless)
      const now = ctx.currentTime;
      const startTime = Math.max(now, nextPlayTimeRef.current);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      // Clean up finished sources to prevent memory leak
      source.onended = () => {
        const idx = scheduledSourcesRef.current.indexOf(source);
        if (idx !== -1) scheduledSourcesRef.current.splice(idx, 1);
      };

      source.start(startTime);
      scheduledSourcesRef.current.push(source);

      // Next chunk starts exactly when this one ends
      nextPlayTimeRef.current = startTime + buffer.duration;

    } catch (e) {
      console.error("[Voice] Audio decode error:", e);
    }
  }, []);

  // ── Connect to Gemini Live API ──
  const connect = useCallback(async () => {
    setError(null);
    console.log("[Voice] Starting connection...");

    try {
      // 1. Get API key from backend
      const tokenRes = await fetch("/api/voice-token", { method: "POST" });
      const tokenData = await tokenRes.json();
      if (tokenData.error) throw new Error(tokenData.error);
      const apiKey = tokenData.token;
      console.log("[Voice] Got API key, connecting WebSocket...");

      // 2. Create playback audio context (24kHz for Gemini output)
      playContextRef.current = new AudioContext({ sampleRate: 24000 });

      // 3. Connect WebSocket — official v1beta endpoint
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[Voice] WebSocket connected, sending setup...");

        // Setup message — v1beta BidiGenerateContent
        const setupMessage = {
          setup: {
            model: "models/gemini-3.1-flash-live-preview",
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: "Kore" }
                }
              }
            },
            systemInstruction: {
              parts: [{ text: systemPrompt }]
            }
          }
        };
        ws.send(JSON.stringify(setupMessage));
        console.log("[Voice] Setup sent, waiting for setupComplete...");
      };

      ws.onmessage = async (event) => {
        try {
          // Handle Blob/ArrayBuffer responses
          let jsonStr: string;
          if (event.data instanceof Blob) {
            jsonStr = await event.data.text();
          } else if (event.data instanceof ArrayBuffer) {
            jsonStr = new TextDecoder().decode(event.data);
          } else {
            jsonStr = event.data;
          }
          const data = JSON.parse(jsonStr);

          // Setup complete — start microphone
          if (data.setupComplete) {
            console.log("[Voice] ✅ Setup complete! Starting microphone...");
            setIsConnected(true);
            startMicrophone();
          }

          // ── Handle interruption (barge-in) ──
          if (data.serverContent?.interrupted) {
            console.log("[Voice] 🔇 Interrupted — stopping playback");
            stopPlayback();
          }

          // Handle model audio response
          if (data.serverContent?.modelTurn?.parts) {
            for (const part of data.serverContent.modelTurn.parts) {
              if (part.inlineData?.data) {
                queueAudio(part.inlineData.data);
              }
              if (part.text) {
                onTranscript(part.text, "assistant");
              }
            }
          }

          // Handle turn complete
          if (data.serverContent?.turnComplete) {
            console.log("[Voice] Model turn complete");
          }

          // Handle transcriptions (if available)
          if (data.serverContent?.outputTranscription?.text) {
            onTranscript(data.serverContent.outputTranscription.text, "assistant");
          }
          if (data.serverContent?.inputTranscription?.text) {
            onTranscript(data.serverContent.inputTranscription.text, "user");
          }

        } catch (e) {
          console.error("[Voice] Message parse error:", e);
        }
      };

      ws.onerror = (e) => {
        console.error("[Voice] WebSocket error:", e);
        setError("Connection error. Please try again.");
        cleanup();
      };

      ws.onclose = (e) => {
        console.log("[Voice] WebSocket closed:", e.code, e.reason);
        setIsConnected(false);
        setIsListening(false);
        if (e.code !== 1000 && e.code !== 1005) {
          setError(`Connection closed: ${e.reason || `Code ${e.code}`}`);
        }
      };

    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      console.error("[Voice] Connect error:", errMsg);
      setError(errMsg);
      cleanup();
    }
  }, [systemPrompt, onTranscript, queueAudio, stopPlayback]);

  // ── Start microphone capture ──
  const startMicrophone = useCallback(async () => {
    try {
      console.log("[Voice] Requesting microphone access...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      mediaStreamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      // ScriptProcessorNode for PCM capture
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Convert to base64
        const uint8 = new Uint8Array(int16.buffer);
        let binary = "";
        for (let i = 0; i < uint8.length; i++) {
          binary += String.fromCharCode(uint8[i]);
        }
        const base64 = btoa(binary);

        // Send audio — v1beta format
        ws.send(JSON.stringify({
          realtimeInput: {
            audio: {
              data: base64,
              mimeType: "audio/pcm;rate=16000"
            }
          }
        }));
      };

      source.connect(processor);
      // Connect to MUTED gain node — prevents mic echo through speakers
      const muteNode = ctx.createGain();
      muteNode.gain.value = 0;
      processor.connect(muteNode);
      muteNode.connect(ctx.destination);

      setIsListening(true);
      console.log("[Voice] 🎙️ Microphone active! Streaming audio...");

    } catch (err) {
      console.error("[Voice] Microphone error:", err);
      setError("Microphone access denied. Please allow microphone access.");
    }
  }, []);

  // ── Cleanup all resources ──
  const cleanup = useCallback(() => {
    stopPlayback();
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    mediaStreamRef.current?.getTracks().forEach(t => t.stop());
    audioContextRef.current?.close().catch(() => {});
    playContextRef.current?.close().catch(() => {});
    wsRef.current = null;
    audioContextRef.current = null;
    playContextRef.current = null;
    mediaStreamRef.current = null;
    processorRef.current = null;
    sourceRef.current = null;
    setIsConnected(false);
    setIsListening(false);
  }, [stopPlayback]);

  // ── Disconnect ──
  const disconnect = useCallback(() => {
    console.log("[Voice] Disconnecting...");
    wsRef.current?.close(1000, "User ended interview");
    cleanup();
    onEnd();
  }, [cleanup, onEnd]);

  return { isConnected, isListening, error, connect, disconnect };
}
