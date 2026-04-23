import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: Request) {
  try {
    const { messages, questions, practiceArea, caseDescription, clientInfo } =
      await req.json();

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    // Count how many AI messages have been sent (each = roughly 1 question asked)
    const aiMessageCount = messages.filter(
      (m: ChatMessage) => m.role === "assistant"
    ).length;
    const totalQuestions = questions.length || 20;
    const isNearEnd = aiMessageCount >= totalQuestions - 2;
    const mustEnd = aiMessageCount >= totalQuestions + 3;

    const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const systemPrompt = `You are Alex, a warm, professional, and highly skilled legal intake specialist at a top U.S. law firm. You are conducting an intake interview with a potential client.

TODAY'S DATE: ${today}

CLIENT INFO (ALREADY PROVIDED — DO NOT ask for these again):
- Name: ${clientInfo.name}
- Email: ${clientInfo.email}
- Phone: ${clientInfo.phone}
- Practice Area: ${practiceArea}
- Brief Case Description: "${caseDescription}"

REFERENCE QUESTIONS (USE AS INSPIRATION ONLY — DO NOT follow rigidly):
${questions.map((q: string, i: number) => `${i + 1}. ${q}`).join("\n")}

PROGRESS: You have exchanged ${aiMessageCount} messages so far out of approximately ${totalQuestions} questions.
${isNearEnd ? "YOU ARE NEAR THE END. Start wrapping up soon." : ""}
${mustEnd ? "YOU MUST END THE INTERVIEW NOW. Say the closing phrase below immediately." : ""}

RULES:
1. Ask ONE question at a time. Never ask multiple questions at once.
2. Start by greeting the client warmly by their first name and acknowledging their situation briefly.
3. The client already provided their name, email, phone, and case description. DO NOT ask for these again. Start with substantive case questions.
4. These questions are GUIDELINES, NOT a script. ADAPT your questions based on the client's actual answers.
   - Example: If a Personal Injury client says "car accident," ask about the other driver, traffic conditions, police report — NOT generic injury questions.
   - Example: If a client says "slip and fall at a store," ask about the store name, floor conditions, witnesses — NOT car accident questions.
5. Skip questions that the client has already answered in previous responses.
6. If a client's answer is vague, ask ONE follow-up to clarify, then move on.
7. Be empathetic but professional. Use plain English.
8. Keep your responses concise (2-3 sentences max).
9. NEVER provide legal advice. You are gathering information only.
10. When you have covered all key questions OR reached ${totalQuestions} exchanges, you MUST end the interview by saying EXACTLY this phrase: "Thank you ${clientInfo.name.split(" ")[0]}, I have all the information I need for now. Let me prepare your case summary."
11. Do NOT keep asking questions after you have covered the main topics. It is better to end early than to repeat yourself.`;

    const geminiContents = messages.map((msg: ChatMessage) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: geminiContents,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.7,
        maxOutputTokens: 800,
      },
    });

    const text =
      response.text ?? "I'm sorry, could you please repeat that?";

    return NextResponse.json({ message: text });
  } catch (error) {
    console.error("Chat error:", error);
    return NextResponse.json(
      { error: "Failed to get AI response." },
      { status: 500 }
    );
  }
}
