'use client';

import { useState } from 'react';

interface RecommendResult {
  line?: string;
  recommended_position?: string;
  reason?: string;
  error?: string;
}

const LINE_COLORS: Record<string, string> = {
  'Line 1': 'bg-blue-700',
  'Line 2': 'bg-green-600',
  'Line 3': 'bg-orange-500',
  'Line 4': 'bg-sky-500',
  'Line 5': 'bg-purple-600',
  'Line 6': 'bg-yellow-700',
  'Line 7': 'bg-olive-600',
  'Line 9': 'bg-yellow-500',
};

const STATION_HINTS = [
  'Gangnam', 'Hongdae', 'Jamsil', 'Seoul Station', 'Myeongdong',
  'Itaewon', 'Hapjeong', 'City Hall', 'Sindorim', 'Dongdaemun',
  'Gyeongbokgung', 'Yeouido', 'Samseong', 'Yeoksam',
];

export default function Home() {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [result, setResult] = useState<RecommendResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showHints, setShowHints] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!start.trim() || !end.trim()) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch(
        `/api/recommend?start=${encodeURIComponent(start.trim())}&end=${encodeURIComponent(end.trim())}`
      );
      const data: RecommendResult = await res.json();
      setResult(data);
    } catch {
      setResult({ error: 'Something went wrong. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const fillExample = (s: string, e: string) => {
    setStart(s);
    setEnd(e);
    setResult(null);
  };

  const lineColorClass = result?.line
    ? LINE_COLORS[result.line] ?? 'bg-gray-600'
    : 'bg-gray-600';

  return (
    <main className="min-h-screen bg-gray-950 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <span className="text-2xl">🚇</span>
          <div>
            <h1 className="text-lg font-bold text-white leading-tight">Seoul Subway Position Guide</h1>
            <p className="text-xs text-gray-400">Board smart. Walk less.</p>
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-8">
        <div className="max-w-lg mx-auto space-y-6">
          {/* Intro card */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-sm text-gray-300 leading-relaxed">
            Enter your <strong className="text-white">start</strong> and <strong className="text-white">destination</strong> station
            to get the recommended car and door number for the quickest exit or transfer.
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="start" className="block text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
                  Start Station
                </label>
                <input
                  id="start"
                  type="text"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  placeholder="e.g. Gangnam"
                  autoComplete="off"
                  className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-[#CCFF00] focus:ring-1 focus:ring-[#CCFF00] transition-colors text-sm"
                />
              </div>
              <div>
                <label htmlFor="end" className="block text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">
                  Destination
                </label>
                <input
                  id="end"
                  type="text"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  placeholder="e.g. Hongdae"
                  autoComplete="off"
                  className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-[#CCFF00] focus:ring-1 focus:ring-[#CCFF00] transition-colors text-sm"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !start.trim() || !end.trim()}
              className="w-full py-3.5 bg-[#CCFF00] text-gray-950 font-bold rounded-xl hover:bg-yellow-300 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all text-sm tracking-wide"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Finding best position...
                </span>
              ) : (
                'Find Best Position →'
              )}
            </button>
          </form>

          {/* Quick examples */}
          <div>
            <button
              onClick={() => setShowHints(!showHints)}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
            >
              <span>{showHints ? '▾' : '▸'}</span>
              {showHints ? 'Hide' : 'Show'} available stations & examples
            </button>

            {showHints && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {STATION_HINTS.map((s) => (
                    <span
                      key={s}
                      className="px-2.5 py-1 bg-gray-800 text-gray-300 text-xs rounded-full border border-gray-700"
                    >
                      {s}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-gray-500">Try these examples:</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    ['Gangnam', 'Hongdae'],
                    ['Seoul Station', 'Myeongdong'],
                    ['Jamsil', 'City Hall'],
                    ['Itaewon', 'Hongdae'],
                  ].map(([s, e]) => (
                    <button
                      key={`${s}-${e}`}
                      onClick={() => fillExample(s, e)}
                      className="px-3 py-1.5 bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg hover:border-[#CCFF00] hover:text-[#CCFF00] transition-colors"
                    >
                      {s} → {e}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Result */}
          {result && (
            <div className="border border-gray-700 rounded-2xl overflow-hidden animate-in fade-in duration-300">
              {result.error ? (
                <div className="p-6 text-center">
                  <div className="text-4xl mb-3">🔍</div>
                  <p className="text-gray-300 font-medium mb-1">No Data Available Yet</p>
                  <p className="text-gray-500 text-sm">
                    We don&apos;t have position data for this route yet.
                    Try one of the example routes above.
                  </p>
                </div>
              ) : (
                <>
                  {/* Line badge + route */}
                  <div className="bg-gray-900 px-6 pt-6 pb-4">
                    <div className="flex items-center justify-between mb-4">
                      <span className={`px-3 py-1 ${lineColorClass} text-white text-xs font-semibold rounded-full`}>
                        {result.line}
                      </span>
                      <span className="text-gray-500 text-xs">
                        {start} → {end}
                      </span>
                    </div>

                    {/* Big position number */}
                    <div className="text-center py-4">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
                        Board at
                      </p>
                      <div className="text-[6rem] font-black leading-none text-[#CCFF00] tracking-tighter">
                        {result.recommended_position}
                      </div>
                      <p className="text-gray-400 text-sm mt-2">
                        Car — Door
                      </p>
                    </div>
                  </div>

                  {/* Reason */}
                  <div className="bg-gray-800/50 px-6 py-4 border-t border-gray-700">
                    <div className="flex gap-3 items-start">
                      <span className="text-[#CCFF00] mt-0.5">💡</span>
                      <p className="text-gray-300 text-sm leading-relaxed">{result.reason}</p>
                    </div>
                  </div>

                  {/* How to read */}
                  <div className="bg-gray-900 px-6 py-3 border-t border-gray-800">
                    <p className="text-xs text-gray-600 text-center">
                      Format: <strong className="text-gray-400">Car-Door</strong> &nbsp;·&nbsp;
                      Count from the front of the train
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-800 px-4 py-4">
        <p className="text-center text-xs text-gray-600">
          Seoul Subway Guide · Data is approximate · Always check station maps
        </p>
      </footer>
    </main>
  );
}
