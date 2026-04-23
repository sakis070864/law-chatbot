import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: Request) {
  try {
    const { messages, practiceArea, caseDescription, clientInfo } =
      await req.json();

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    const transcript = messages
      .map(
        (m: ChatMessage) =>
          `${m.role === "user" ? "Client" : "Interviewer"}: ${m.content}`
      )
      .join("\n");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      contents: `You are a senior legal analyst. Below is the full transcript of an intake interview.

CLIENT INFORMATION:
- Name: ${clientInfo.name}
- Email: ${clientInfo.email}
- Phone: ${clientInfo.phone}
- Practice Area: ${practiceArea}
- Brief Description: "${caseDescription}"

FULL INTERVIEW TRANSCRIPT:
${transcript}

Generate a comprehensive, professional intake summary report.

CRITICAL FORMAT RULES:
- Output ONLY clean plain text. NO markdown symbols whatsoever.
- NO asterisks (*), NO hash symbols (#), NO underscores for formatting.
- Use UPPERCASE for section headers.
- Use numbers (1, 2, 3) for lists instead of bullet points.
- Use line breaks to separate sections.
- Write in a professional, clean format that looks good in both plain text and email.

Use this exact structure:

CLIENT INTAKE SUMMARY
=====================

CLIENT INFORMATION
Name: ${clientInfo.name}
Email: ${clientInfo.email}
Phone: ${clientInfo.phone}
Practice Area: ${practiceArea}
Date: ${new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })}

CASE OVERVIEW
A 3-4 sentence executive summary of the case.

KEY FACTS
1. First important fact
2. Second important fact
(continue numbering)

TIMELINE OF EVENTS
1. Date/Event
2. Date/Event
(continue numbering)

PARTIES INVOLVED
1. Name - Role/Relationship
(continue)

DAMAGES AND INJURIES
Description of any damages, injuries, or losses.

DOCUMENTATION AND EVIDENCE
1. Document/evidence available or needed
(continue)

STRENGTHS OF THE CASE
1. First strength
(continue)

WEAKNESSES AND RISKS
1. First risk
(continue)

REQUIRED DOCUMENTS CHECKLIST
1. First document needed
(continue)

RECOMMENDED NEXT STEPS
1. First action
(continue)

Be thorough, accurate, and professional. Only include information that was actually discussed in the interview. Do not fabricate details.`,
      config: {
        temperature: 0.2,
        maxOutputTokens: 4000,
      },
    });

    const summary = response.text ?? "Failed to generate summary.";

    return NextResponse.json({ summary });
  } catch (error) {
    console.error("Summarize error:", error);
    return NextResponse.json(
      { error: "Failed to generate summary." },
      { status: 500 }
    );
  }
}
