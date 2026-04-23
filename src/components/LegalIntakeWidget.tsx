"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useGeminiVoice } from "@/hooks/useGeminiVoice";
import intakeQuestions from "@/data/intake-questions.json";

const PRACTICE_AREAS = [
  "Family Law (Divorce, Custody)",
  "Criminal Defense",
  "Personal Injury",
  "Real Estate",
  "Corporate Law",
  "Immigration",
  "Employment Law",
  "Bankruptcy",
  "Estate Planning",
  "Intellectual Property",
];

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

type WidgetScreen = "form" | "loading" | "chat" | "voice" | "summary" | "sent";

export default function LegalIntakeWidget() {
  // Widget state
  const [isOpen, setIsOpen] = useState(false);
  const [screen, setScreen] = useState<WidgetScreen>("form");

  // Form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [practiceArea, setPracticeArea] = useState(PRACTICE_AREAS[0]);
  const [caseDescription, setCaseDescription] = useState("");

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  // Summary state
  const [summary, setSummary] = useState("");
  const [isSending, setIsSending] = useState(false);

  // Voice state
  const [voiceTranscript, setVoiceTranscript] = useState<ChatMessage[]>([]);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Build voice system prompt
  const buildVoicePrompt = useCallback(() => {
    const qList = questions.length > 0
      ? questions.map((q, i) => `${i + 1}. ${q}`).join("\n")
      : "Ask relevant intake questions for this type of case.";
    return `You are Alex, a warm, professional, and highly skilled legal intake specialist at a top U.S. law firm. You are conducting a voice intake interview.

TODAY'S DATE: ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}

START BY GREETING THE CLIENT. Say something like: "Hi ${name || "there"}, I'm Alex from the legal intake team. Thank you for reaching out. I'll ask you a few questions about your ${practiceArea} case so we can understand how to help you. Let's get started."

CLIENT INFO (ALREADY PROVIDED — DO NOT ask for these again):
- Name: ${name}
- Practice Area: ${practiceArea}
- Initial Case Description: "${caseDescription}"

REFERENCE QUESTIONS (USE AS INSPIRATION ONLY — DO NOT follow rigidly):
${qList}

IMPORTANT RULES:
1. Ask ONE question at a time. Wait for the client to answer before continuing.
2. These questions are GUIDELINES, NOT a script. ADAPT your questions based on the client's actual answers.
   - Example: If a Personal Injury client says "car accident," ask about the other driver, traffic conditions, police report — NOT generic injury questions.
   - Example: If a client says "slip and fall at a store," ask about the store name, floor conditions, witnesses — NOT car accident questions.
3. Listen actively. If an answer is vague or incomplete, ask a natural follow-up to clarify.
4. Skip questions that the client has already answered in previous responses.
5. Be empathetic, use plain English, and keep each response to 2-3 short sentences.
6. NEVER give legal advice or opinions on the case.
7. Cover approximately 15-20 questions total, adapting as needed.
8. When you have gathered enough information, say: "Thank you ${name || ""}, I have all the information I need. Please click the End Interview button to receive your summary."`;
  }, [name, practiceArea, caseDescription, questions]);

  const handleVoiceTranscript = useCallback((text: string, role: "user" | "assistant") => {
    setVoiceTranscript(prev => [...prev, { role, content: text }]);
  }, []);

  const handleVoiceEnd = useCallback(() => {
    // Voice session ended, go to summary
  }, []);

  const geminiVoice = useGeminiVoice({
    systemPrompt: buildVoicePrompt(),
    onTranscript: handleVoiceTranscript,
    onEnd: handleVoiceEnd,
  });

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // ── STEP 1: Load Pre-Built Questions (INSTANT — no API call) ──
  const loadQuestions = useCallback(() => {
    const areaQuestions = (intakeQuestions as Record<string, string[]>)[practiceArea];
    if (areaQuestions && areaQuestions.length > 0) {
      setQuestions(areaQuestions);
      return areaQuestions;
    }
    // Fallback: generic questions if practice area not found
    const fallback = ["Please describe your legal issue in detail.", "When did this issue first arise?", "Have you consulted with another attorney?"];
    setQuestions(fallback);
    return fallback;
  }, [practiceArea]);

  const handleStartTextInterview = async () => {
    setScreen("loading");
    try {
      const qs = loadQuestions();
      setScreen("chat");
      const greeting = await getAIResponse(
        [{ role: "user", content: "Hello, I need legal help." }],
        qs
      );
      setMessages([{ role: "assistant", content: greeting }]);
    } catch (err) {
      console.error(err);
      setScreen("form");
      alert("Failed to start interview. Please try again.");
    }
  };

  const handleStartVoiceInterview = () => {
    loadQuestions();
    setVoiceTranscript([]);
    setScreen("voice");
    // Voice connects when screen renders — INSTANT, no loading screen needed
  };

  // ── STEP 2: Chat with AI Interviewer ──
  const getAIResponse = async (
    chatHistory: ChatMessage[],
    qs: string[]
  ): Promise<string> => {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: chatHistory,
        questions: qs,
        practiceArea,
        caseDescription,
        clientInfo: { name, email, phone },
      }),
    });
    const data = await res.json();
    return data.message;
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || isTyping) return;

    const userMsg: ChatMessage = { role: "user", content: inputText.trim() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInputText("");
    setIsTyping(true);

    try {
      const aiReply = await getAIResponse(updatedMessages, questions);
      setMessages([...updatedMessages, { role: "assistant", content: aiReply }]);

      // Check if interview is complete
      if (
        aiReply.toLowerCase().includes("i have all the information") ||
        aiReply.toLowerCase().includes("prepare your case summary")
      ) {
        setTimeout(() => handleGenerateSummary([...updatedMessages, { role: "assistant", content: aiReply }]), 2000);
      }
    } catch {
      setMessages([
        ...updatedMessages,
        { role: "assistant", content: "I'm sorry, there was an error. Could you repeat that?" },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  // ── STEP 3: Generate Summary ──
  const handleGenerateSummary = async (chatMsgs?: ChatMessage[]) => {
    setScreen("loading");
    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: chatMsgs || messages,
          practiceArea,
          caseDescription,
          clientInfo: { name, email, phone },
        }),
      });
      const data = await res.json();
      setSummary(data.summary);
      setScreen("summary");
    } catch {
      alert("Failed to generate summary.");
      setScreen("chat");
    }
  };

  // ── STEP 4: Send Email to Lawyer ──
  const handleSendToLawyer = async () => {
    setIsSending(true);
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary,
          clientInfo: { name, email, phone },
          practiceArea,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setScreen("sent");
      } else {
        alert("Failed to send email. Please try again.");
      }
    } catch {
      alert("Failed to send email.");
    } finally {
      setIsSending(false);
    }
  };

  // Reset everything
  const handleReset = () => {
    setScreen("form");
    setMessages([]);
    setQuestions([]);
    setSummary("");
    setInputText("");
    setName("");
    setEmail("");
    setPhone("");
    setCaseDescription("");
    setPracticeArea(PRACTICE_AREAS[0]);
  };

  // ── FLOATING BUTTON ──
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white p-4 rounded-full shadow-2xl transition-all duration-300 z-50 flex items-center justify-center animate-pulse hover:animate-none"
        aria-label="Open Legal Intake"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      </button>
    );
  }

  // ── MAIN WIDGET ──
  return (
    <div className="legal-intake-widget fixed bottom-6 right-6 w-[420px] h-[620px] bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden z-50 flex flex-col font-sans">
      {/* ── Header ── */}
      <div className="bg-gradient-to-r from-slate-900 to-blue-900 p-4 text-white flex justify-between items-center shrink-0">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Legal Consultation</h2>
          <p className="text-blue-300 text-xs">AI-Powered Intake Assistant</p>
        </div>
        <button onClick={() => setIsOpen(false)} className="text-blue-300 hover:text-white transition-colors p-1">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* ── FORM SCREEN ── */}
      {screen === "form" && (
        <div className="p-5 flex flex-col gap-3 overflow-y-auto flex-1">
          <p className="text-sm text-gray-500">Please provide your details to begin the consultation.</p>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Full Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="John Doe"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="john@example.com"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="(555) 123-4567"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Area of Law</label>
            <select
              value={practiceArea}
              onChange={(e) => setPracticeArea(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              {PRACTICE_AREAS.map((area) => (
                <option key={area} value={area}>{area}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Briefly Describe Your Case</label>
            <textarea
              value={caseDescription}
              onChange={(e) => setCaseDescription(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
              placeholder="E.g., Car accident on Main St., other driver ran a red light..."
              rows={3}
            />
          </div>

          <div className="flex flex-col gap-2 mt-2">
            <button
              onClick={handleStartTextInterview}
              disabled={!name || !email || !phone || !caseDescription}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 disabled:from-gray-300 disabled:to-gray-300 disabled:cursor-not-allowed text-white py-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              Start Text Interview
            </button>

            <button
              onClick={handleStartVoiceInterview}
              disabled={!name || !email || !phone || !caseDescription}
              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:from-gray-300 disabled:to-gray-300 disabled:cursor-not-allowed text-white py-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              Start Voice Interview
            </button>
          </div>
        </div>
      )}

      {/* ── LOADING SCREEN ── */}
      {screen === "loading" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
          <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
          <p className="text-sm text-gray-500 text-center">
            AI is researching the best questions for your case...
          </p>
          <p className="text-xs text-gray-400">This may take a few seconds</p>
        </div>
      )}

      {/* ── CHAT SCREEN ── */}
      {screen === "chat" && (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] p-3 rounded-2xl text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white rounded-br-md"
                      : "bg-white text-gray-800 border border-gray-200 rounded-bl-md shadow-sm"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-md p-3 shadow-sm">
                  <div className="flex gap-1.5">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat Input */}
          <div className="p-3 bg-white border-t border-gray-200 shrink-0">
            <div className="flex gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                placeholder="Type your answer..."
                className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                disabled={isTyping}
              />
              <button
                onClick={handleSendMessage}
                disabled={!inputText.trim() || isTyping}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white px-4 py-2.5 rounded-xl transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                </svg>
              </button>
            </div>
            <button
              onClick={() => handleGenerateSummary()}
              className="w-full mt-2 text-xs text-blue-600 hover:text-blue-800 underline transition-colors"
            >
              End Interview & Generate Summary
            </button>
          </div>
        </>
      )}

      {/* ── VOICE SCREEN ── */}
      {screen === "voice" && (
        <>
          <div className="flex-1 flex flex-col items-center justify-center bg-gradient-to-b from-gray-50 to-white relative overflow-hidden">
            {/* Animated rings */}
            <div className="relative flex items-center justify-center">
              <div className={`absolute w-32 h-32 rounded-full border-2 border-emerald-300 ${geminiVoice.isListening ? 'animate-ping' : ''}`} style={{ animationDuration: '2s' }} />
              <div className={`absolute w-40 h-40 rounded-full border border-emerald-200 ${geminiVoice.isListening ? 'animate-ping' : ''}`} style={{ animationDuration: '3s' }} />
              <div className={`absolute w-48 h-48 rounded-full border border-emerald-100 ${geminiVoice.isListening ? 'animate-ping' : ''}`} style={{ animationDuration: '4s' }} />

              {/* Microphone button */}
              <button
                onClick={() => {
                  if (!geminiVoice.isConnected) {
                    geminiVoice.connect();
                  }
                }}
                className={`relative z-10 w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 shadow-xl ${
                  geminiVoice.isConnected
                    ? 'bg-gradient-to-br from-emerald-500 to-teal-600 scale-110'
                    : 'bg-gradient-to-br from-emerald-600 to-teal-700 hover:scale-105'
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </button>
            </div>

            <p className={`mt-6 text-sm font-medium ${geminiVoice.isConnected ? 'text-emerald-600' : geminiVoice.error ? 'text-red-500' : 'text-gray-500'}`}>
              {geminiVoice.error ? `⚠️ ${geminiVoice.error}` : !geminiVoice.isConnected ? 'Click microphone to start' : geminiVoice.isListening ? '🎙️ Listening... Speak now!' : '⏳ Connecting...'}
            </p>
            <p className="text-xs text-gray-400 mt-1">Powered by Gemini AI • Natural Voice</p>
            {geminiVoice.error && (
              <button
                onClick={() => geminiVoice.connect()}
                className="mt-2 text-xs text-blue-600 hover:text-blue-800 underline"
              >
                Try Again
              </button>
            )}

            {/* Live transcript */}
            {voiceTranscript.length > 0 && (
              <div className="absolute bottom-0 left-0 right-0 max-h-32 overflow-y-auto p-3 bg-white/80 backdrop-blur border-t border-gray-200">
                {voiceTranscript.slice(-4).map((msg, i) => (
                  <p key={i} className={`text-xs mb-1 ${msg.role === 'user' ? 'text-blue-600' : 'text-gray-700'}`}>
                    <span className="font-semibold">{msg.role === 'user' ? 'You' : 'Alex'}:</span> {msg.content}
                  </p>
                ))}
              </div>
            )}
          </div>

          {/* Voice controls */}
          <div className="p-3 bg-white border-t border-gray-200 shrink-0 flex gap-2">
            <button
              onClick={() => {
                geminiVoice.disconnect();
                if (voiceTranscript.length > 0) {
                  setMessages(voiceTranscript);
                  handleGenerateSummary(voiceTranscript);
                } else {
                  setScreen("form");
                }
              }}
              className="flex-1 bg-red-500 hover:bg-red-600 text-white py-3 rounded-lg font-semibold transition-all text-sm"
            >
              End Interview & Get Summary
            </button>
          </div>
        </>
      )}

      {/* ── SUMMARY SCREEN ── */}
      {screen === "summary" && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
                <span>📋</span> Interview Summary
              </h3>
              <div className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap font-mono">
                {summary}
              </div>
            </div>
          </div>
          <div className="p-4 border-t border-gray-200 shrink-0 space-y-2">
            <button
              onClick={handleSendToLawyer}
              disabled={isSending}
              className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:from-gray-300 disabled:to-gray-300 text-white py-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2"
            >
              {isSending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <span>📧</span> Send Summary to Lawyer
                </>
              )}
            </button>
            <button
              onClick={() => setScreen("chat")}
              className="w-full text-xs text-gray-500 hover:text-gray-700 underline"
            >
              ← Go back to interview
            </button>
          </div>
        </div>
      )}

      {/* ── SENT CONFIRMATION SCREEN ── */}
      {screen === "sent" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-green-600" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-800">Summary Sent!</h3>
          <p className="text-sm text-gray-500">
            The intake summary has been delivered to the attorney&apos;s inbox. You will be contacted shortly.
          </p>
          <button
            onClick={handleReset}
            className="mt-4 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-medium transition-colors text-sm"
          >
            Start New Consultation
          </button>
        </div>
      )}
    </div>
  );
}
