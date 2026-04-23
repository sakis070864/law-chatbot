import LegalIntakeWidget from "@/components/LegalIntakeWidget";

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-8 font-sans">
      <div className="max-w-2xl text-center space-y-6">
        <h1 className="text-4xl font-bold text-gray-900">Demo Law Firm Website</h1>
        <p className="text-lg text-gray-600">
          This is a placeholder website to demonstrate how the Legal Intake Widget looks when embedded on a lawyer's webpage.
        </p>
        <p className="text-md text-gray-500">
          Look at the bottom right corner of your screen to interact with the AI Assistant Widget.
        </p>
      </div>

      {/* The Embeddable Widget */}
      <LegalIntakeWidget />
    </div>
  );
}
