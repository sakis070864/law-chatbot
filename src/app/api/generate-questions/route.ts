import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { practiceArea, caseDescription } = await req.json();

    if (!practiceArea || !caseDescription) {
      return NextResponse.json(
        { error: "Practice area and case description are required." },
        { status: 400 }
      );
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `You are an expert legal intake specialist working for a top U.S. law firm.

A new client has come in with the following details:
- Practice Area: ${practiceArea}
- Brief Case Description: "${caseDescription}"

Your task: Search the internet and find the 20 most critical intake questions that top-tier U.S. law firms ask clients in this specific type of case. The questions must be:
1. Specific to the case description (not generic)
2. Ordered from most important to least important
3. Cover: facts of the case, timeline, parties involved, damages/injuries, prior legal actions, documentation, witnesses, insurance, and client goals
4. Written in plain English (the client is not a lawyer)

Return ONLY a valid JSON array of exactly 20 strings. No explanation, no markdown, no numbering. Just the JSON array.
Example format: ["Question 1?", "Question 2?", ...]`,
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.3,
      },
    });

    const text = response.text ?? "";

    // Extract JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error("Failed to parse questions from Gemini response:", text);
      return NextResponse.json(
        { error: "Failed to generate questions. Please try again." },
        { status: 500 }
      );
    }

    const questions: string[] = JSON.parse(jsonMatch[0]);

    return NextResponse.json({ questions });
  } catch (error) {
    console.error("Generate questions error:", error);
    return NextResponse.json(
      { error: "Internal server error while generating questions." },
      { status: 500 }
    );
  }
}
