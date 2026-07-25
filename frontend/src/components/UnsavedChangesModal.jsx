export default function UnsavedChangesModal({ onSaveDraft, onLeave, onStay }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-md shadow-modal max-w-md w-full p-6">
        <div className="flex items-start gap-4 mb-5">
          <div className="w-11 h-11 rounded-full bg-amber-100 flex items-center justify-center shrink-0 text-xl">⚠️</div>
          <div>
            <h3 className="font-semibold text-gray-900 text-lg leading-tight">Unsaved Changes</h3>
            <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
              You have unsaved changes that will be lost if you leave this page.
              You can save a draft to continue later.
            </p>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-sm px-4 py-3 text-xs text-amber-800 mb-5">
          💡 <span className="font-semibold">Save Draft</span> stores your changes in this browser — you can restore them next time you visit this section.
        </div>

        <div className="flex flex-col sm:flex-row gap-2 justify-end">
          <button
            onClick={onStay}
            className="order-3 sm:order-1 px-4 py-2.5 text-sm border border-gray-200 rounded-sm text-gray-600 hover:bg-gray-50 font-medium"
          >
            Stay on Page
          </button>
          <button
            onClick={onLeave}
            className="order-2 px-4 py-2.5 text-sm border border-red-200 text-red-600 rounded-sm hover:bg-red-50 font-medium"
          >
            Leave Anyway
          </button>
          <button
            onClick={onSaveDraft}
            className="order-1 sm:order-3 px-5 py-2.5 text-sm bg-brand-600 text-white font-semibold rounded-sm hover:bg-brand-700"
          >
            Save Draft &amp; Leave
          </button>
        </div>
      </div>
    </div>
  );
}
