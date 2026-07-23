import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { api } from '../api/client.js';
import { confirm } from '../utils/confirm.js';

export default function GmailConnectCard({ onStatusChange }) {
  const [status, setStatus]   = useState(null); // { connected, gmailEmail, lastSynced, configured }
  const [syncing, setSyncing] = useState(false);

  async function loadStatus() {
    try {
      const s = await api.get('/gmail/status');
      setStatus(s);
      onStatusChange?.(s);
    } catch { /* silent */ }
  }

  useEffect(() => { loadStatus(); }, []);

  // Check URL params for OAuth callback result (redirected back from /api/oauth/google/callback)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth') === 'connected') {
      toast.success('Gmail connected successfully!');
      // Remove the param from URL
      window.history.replaceState({}, '', window.location.pathname);
      loadStatus();
    }
    if (params.get('oauth_error')) {
      toast.error('Gmail connection failed: ' + decodeURIComponent(params.get('oauth_error')));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  async function handleConnect() {
    try {
      const { url } = await api.get('/oauth/google/start');
      window.location.href = url;
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not get Google OAuth URL');
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const result = await api.post('/gmail/sync');
      toast.success(`Synced ${result.imported} emails (${result.total} scanned)`);
      loadStatus();
      onStatusChange?.({ ...status, synced: true });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    if (!await confirm('Disconnect Gmail? Your tracked emails will be preserved.')) return;
    try {
      await api.delete('/gmail/disconnect');
      toast('Gmail disconnected');
      loadStatus();
    } catch { toast.error('Disconnect failed'); }
  }

  if (!status) {
    return <div className="h-24 bg-gray-100 animate-pulse rounded-xl" />;
  }

  if (!status.configured) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
        <span className="text-2xl">⚠️</span>
        <div>
          <p className="font-semibold text-amber-800 text-sm">Gmail not configured</p>
          <p className="text-amber-700 text-xs mt-0.5">
            Add <code className="bg-amber-100 px-1 rounded">GOOGLE_CLIENT_ID</code> and{' '}
            <code className="bg-amber-100 px-1 rounded">GOOGLE_CLIENT_SECRET</code> to your backend <code>.env</code> file.{' '}
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-amber-800 hover:text-amber-900"
            >
              Get credentials →
            </a>
          </p>
        </div>
      </div>
    );
  }

  if (!status.connected) {
    return (
      <div className="bg-white border-2 border-dashed border-blue-300 rounded-xl p-5 flex flex-col items-center gap-3 text-center">
        <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-2xl">📧</div>
        <div>
          <p className="font-semibold text-gray-800">Connect your Gmail</p>
          <p className="text-gray-500 text-xs mt-1">
            Scan the last 18 months of your sent mail to surface every past contact — reply
            detection and quick-reply all work through Gmail. Only headers and subjects are
            read, never your message content.
          </p>
        </div>
        <button
          onClick={handleConnect}
          className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors"
        >
          Connect Gmail Account
        </button>
      </div>
    );
  }

  if (!status.hasMetadataScope) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center text-lg">🔒</div>
          <div>
            <p className="font-semibold text-amber-800 text-sm">Gmail connected — Sync needs a permission update</p>
            <p className="text-amber-700 text-xs">{status.gmailEmail}</p>
            <p className="text-amber-600 text-xs mt-0.5">
              Reconnect to grant Gmail Sync read access (headers/subjects only — never your message content).
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleConnect}
            className="px-4 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700 transition-colors"
          >
            Reconnect Gmail
          </button>
          <button
            onClick={handleDisconnect}
            className="px-3 py-1.5 text-red-500 hover:text-red-700 text-xs font-medium"
          >
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center text-lg">✅</div>
        <div>
          <p className="font-semibold text-green-800 text-sm">Gmail Connected</p>
          <p className="text-green-700 text-xs">{status.gmailEmail}</p>
          {status.lastSynced && (
            <p className="text-green-600 text-xs">Last synced: {status.lastSynced.slice(0, 16)}</p>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleSync}
          disabled={syncing}
          className="px-4 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 disabled:opacity-60 transition-colors"
        >
          {syncing ? '⏳ Syncing…' : '🔄 Sync Now'}
        </button>
        <button
          onClick={handleDisconnect}
          className="px-3 py-1.5 text-red-500 hover:text-red-700 text-xs font-medium"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}
