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
  const audioQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // ── Stop all playback immediately (for barge-in/interruption) ──
  const stopPlayback = useCallback(() => {
    // Stop current playing audio
    try {
      currentSourceRef.current?.stop();
    } catch {
      // ignore if already stopped
    }
    currentSourceRef.current = null;
    // Clear the queue
    audioQueueRef.current = [];
    isPlayingRef.current = false;
  }, []);

  // ── Play queued audio chunks ──
  const playNextChunk = useCallback(() => {
    const ctx = playContextRef.current;
    if (!ctx || audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      currentSourceRef.current = null;
      return;
    }
    isPlayingRef.current = true;

    const pcmData = audioQueueRef.current.shift()!;
    const int16 = new Int16Array(pcmData);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => playNextChunk();
    currentSourceRef.current = source;
    source.start();
  }, []);

  const queueAudio = useCallback((base64Data: string) => {
    try {
      const binaryStr = atob(base64Data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      audioQueueRef.current.push(bytes.buffer);
      if (!isPlayingRef.current) {
        playNextChunk();
      }
    } catch (e) {
      console.error("[Voice] Audio decode error:", e);
    }
  }, [playNextChunk]);

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
          // Handle Blob/ArrayBuffer responses (official Google pattern)
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
          // When the server detects user is speaking, it sends interrupted=true
          if (data.serverContent?.interrupted) {
            console.log("[Voice] 🔇 Interrupted! User is speaking — stopping playback");
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

          // Handle turn complete — model finished speaking
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
      // ⚠️ Connect to a MUTED gain node — NOT to ctx.destination
      // This prevents mic audio from playing through speakers (echo/feedback)
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
