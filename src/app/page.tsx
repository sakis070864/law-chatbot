import LegalIntakeWidget from "@/components/LegalIntakeWidget";

export default function Home() {
  return (
    <main className="fixed inset-0 flex items-center justify-center w-full h-full bg-slate-900/40 backdrop-blur-sm pointer-events-none">
      <div className="pointer-events-auto">
        <LegalIntakeWidget />
      </div>
    </main>
  );
}
