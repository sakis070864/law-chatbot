import { NextResponse } from "next/server";

export async function POST() {
  try {
    // Return the API key for WebSocket connection
    // In production, use ephemeral tokens instead
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "API key not configured" },
        { status: 500 }
      );
    }
    return NextResponse.json({ token: apiKey });
  } catch (error) {
    console.error("Voice token error:", error);
    return NextResponse.json(
      { error: "Failed to create session token." },
      { status: 500 }
    );
  }
}
