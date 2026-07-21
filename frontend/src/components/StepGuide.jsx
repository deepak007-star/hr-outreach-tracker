// Compact "how to use this tool" strip — same numbered-step visual language
// as the landing page's How It Works section, scoped to one specific tool.
export default function StepGuide({ steps }) {
  return (
    <div className="font-landing bg-white rounded-2xl border border-stone-200 p-5">
      <p className="text-[11px] font-bold tracking-widest text-emerald-700 uppercase mb-4">How it works</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {steps.map((s, i) => (
          <div key={s.n} className="relative">
            <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center font-display font-bold text-xs mb-3">
              {s.n}
            </div>
            <h4 className="text-sm font-semibold text-stone-800 mb-1">{s.title}</h4>
            <p className="text-xs text-stone-500 leading-relaxed">{s.desc}</p>
            {i < steps.length - 1 && (
              <span className="hidden sm:block absolute top-4 -right-2.5 w-5 h-px bg-stone-300" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
