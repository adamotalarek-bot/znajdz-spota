import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 bg-gray-50 p-4">
      <h1 className="text-3xl font-bold text-blue-600 mb-4">
        Siema! To moja apka Znajdź Spota! 📍
      </h1>

      <div className="flex flex-col gap-4 w-full max-w-sm">
        {/* Przycisk 1 */}
        <Link 
          href="/o_mnie" 
          className="bg-blue-500 hover:bg-blue-600 text-white text-center py-6 px-4 rounded-2xl text-xl font-semibold shadow-lg transition-all"
        >
          O mnie
        </Link>

        {/* Przycisk 2 */}
        <Link 
          href="/register_page" 
          className="bg-green-500 hover:bg-green-600 text-white text-center py-6 px-4 rounded-2xl text-xl font-semibold shadow-lg transition-all"
        >
          Znajdź Spota
        </Link>
      </div>
    </div>
  );
}