import { useState, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { API_ROOT } from '../api/client.js';

function getAuthHeaders() {
  const token = localStorage.getItem('hr_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function ImportModal({ onClose, onImported }) {
  const [dragging, setDragging] = useState(false);
  const [result,   setResult]   = useState(null);
  const [loading,  setLoading]  = useState(false);
  const inputRef = useRef();

  const upload = async (file) => {
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      toast.error('Only .xlsx, .xls, .csv files are supported');
      return;
    }
    setLoading(true);
    if (inputRef.current) inputRef.current.value = '';
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(`${API_ROOT}/api/contacts/import`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: fd,
      });
      let data;
      try { data = await res.json(); } catch { data = {}; }
      if (!res.ok) throw new Error(data.error || `Import failed (${res.status})`);
      setResult(data);
      toast.success(`Imported ${data.imported} contact${data.imported !== 1 ? 's' : ''} — Excel updated`);
    } catch (err) {
      toast.error(err.message || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-base font-bold">Import Contacts</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700 space-y-1">
            <p className="font-semibold">Required columns:</p>
            <p><span className="font-medium">name</span>, <span className="font-medium">email</span></p>
            <p className="text-blue-600">Optional: title, company, status, notes, tags, source_url (or url)</p>
            <p className="text-blue-500 mt-1">Duplicate emails are silently skipped.</p>
          </div>

          <div
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
              ${dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
            onDragOver  ={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave ={() => setDragging(false)}
            onDrop      ={e => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files[0]); }}
            onClick     ={() => !loading && inputRef.current.click()}
          >
            {loading ? (
              <p className="text-gray-400 text-sm animate-pulse">Parsing and importing…</p>
            ) : (
              <>
                <p className="text-3xl mb-2">📂</p>
                <p className="text-sm text-gray-500 font-medium">Drop file here or click to browse</p>
                <p className="text-xs text-gray-400 mt-1">.xlsx · .xls · .csv</p>
              </>
            )}
            <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" hidden
              onChange={e => upload(e.target.files[0])} />
          </div>

          {result && (
            <div className="rounded-lg border divide-y text-sm overflow-hidden">
              <div className="px-4 py-2.5 bg-green-50 text-green-700 font-medium">Import complete</div>
              <div className="px-4 py-2 flex justify-between">
                <span className="text-gray-600">Imported</span>
                <span className="font-semibold text-green-600">{result.imported}</span>
              </div>
              <div className="px-4 py-2 flex justify-between">
                <span className="text-gray-600">Skipped (missing fields or duplicate email)</span>
                <span className="font-medium text-yellow-600">{result.skipped}</span>
              </div>
              {result.errors?.length > 0 && (
                <div className="px-4 py-2 flex justify-between">
                  <span className="text-gray-600">Errors</span>
                  <span className="font-medium text-red-500">{result.errors.length}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3">
            {result ? (
              <button onClick={onImported}
                className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 transition">
                View Contacts
              </button>
            ) : (
              <button onClick={onClose}
                className="flex-1 border rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50 transition">
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
