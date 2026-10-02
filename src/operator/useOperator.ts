import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventFile } from '../domain/schema';
import { OperatorApiError, OperatorClient } from './client';
import type { DraftEnvelope, FormInputs, OperatorState, SaveDraftRequest } from './contracts';

/** Persist a distinct id for this tab; BroadcastChannel detects duplicated tabs that copied sessionStorage. */
async function openClient(): Promise<{ client: OperatorClient; close: () => void }> {
  let clientId = sessionStorage.getItem('rg26.operator.session') ?? crypto.randomUUID();
  const nonce = crypto.randomUUID();
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('rg26.operator.tabs');
  let duplicate = false;
  if (channel) {
    channel.onmessage = (event: MessageEvent<{ type: string; clientId: string; nonce: string }>) => {
      const data = event.data;
      if (data.clientId !== clientId) return;
      if (data.type === 'claim' && data.nonce !== nonce) channel.postMessage({ type: 'occupied', clientId, nonce: data.nonce });
      if (data.type === 'occupied' && data.nonce === nonce) duplicate = true;
    };
    channel.postMessage({ type: 'claim', clientId, nonce });
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (duplicate) clientId = crypto.randomUUID();
    channel.onmessage = (event: MessageEvent<{ type: string; clientId: string; nonce: string }>) => {
      if (event.data.type === 'claim' && event.data.clientId === clientId) channel.postMessage({ type: 'occupied', clientId, nonce: event.data.nonce });
    };
  }
  sessionStorage.setItem('rg26.operator.session', clientId);
  return { client: new OperatorClient(clientId), close: () => channel?.close() };
}

export function useOperator() {
  const [state, setState] = useState<OperatorState | null>(null);
  const [draft, setDraft] = useState<DraftEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState(false);
  const client = useRef<OperatorClient | null>(null);
  const local = useRef<DraftEnvelope | null>(null);
  const generation = useRef(0);
  const savedGeneration = useRef(0);
  const savePromise = useRef<Promise<DraftEnvelope | null> | null>(null);
  const readOnly = useRef(true);
  const closed = useRef(false);

  const install = useCallback((next: OperatorState, force = false) => {
    readOnly.current = next.readOnly;
    // A slow state poll may finish after a newer PUT. Never roll a saved draft back.
    if (!force && local.current && next.draft.version < local.current.version) {
      setState((current) => current ? { ...current, readOnly: next.readOnly } : next);
      return;
    }
    setState(next);
    if (force || generation.current === savedGeneration.current) {
      local.current = next.draft; setDraft(next.draft);
      generation.current += 1; savedGeneration.current = generation.current;
      setPending(false);
    }
  }, []);

  useEffect(() => {
    let cancel = false;
    let closeChannel: (() => void) | undefined;
    closed.current = false;
    void openClient().then(async (opened) => {
      if (cancel) { opened.close(); return; }
      client.current = opened.client; closeChannel = opened.close;
      const initial = await opened.client.session();
      if (!cancel) { install(initial, true); setError(null); }
    }).catch((cause: unknown) => { if (!cancel) setError(cause instanceof Error ? cause.message : '本地服务初始化失败'); });
    return () => { cancel = true; closed.current = true; closeChannel?.(); };
  }, [install]);

  const flush = useCallback(async (): Promise<DraftEnvelope | null> => {
    if (savePromise.current) {
      await savePromise.current;
      // Further typing during a request is saved using the returned server version.
      if (generation.current !== savedGeneration.current) return flush();
      return local.current;
    }
    if (!client.current || !local.current || readOnly.current) return local.current;
    if (generation.current === savedGeneration.current) return local.current;
    const current = local.current;
    const atGeneration = generation.current;
    const request: SaveDraftRequest = { expectedVersion: current.version, event: current.event,
      formInputs: current.formInputs, migrationRequiresReview: current.migrationRequiresReview, message: '自动保存工作台草稿' };
    setSaving(true);
    const promise = client.current.request<DraftEnvelope>('/draft', 'PUT', request).then((saved) => {
      savedGeneration.current = atGeneration;
      const next = generation.current === atGeneration ? saved : { ...local.current!, version: saved.version,
        baseRevision: saved.baseRevision, baseCommit: saved.baseCommit, updatedAt: saved.updatedAt };
      local.current = next;
      if (!closed.current) { setDraft(next); setPending(generation.current !== atGeneration); setError(null); }
      return next;
    }).catch((cause: unknown) => {
      if (cause instanceof OperatorApiError && cause.status === 403) { readOnly.current = true; setState((s) => s ? { ...s, readOnly: true } : s); }
      const message = cause instanceof Error ? cause.message : '草稿保存失败';
      if (!closed.current) setError(message);
      throw cause;
    }).finally(() => { savePromise.current = null; if (!closed.current) setSaving(false); });
    savePromise.current = promise;
    await promise;
    if (generation.current !== savedGeneration.current) return flush();
    return local.current;
  }, []);

  const update = useCallback((change: (current: DraftEnvelope) => DraftEnvelope) => {
    if (!local.current || readOnly.current) return;
    const next = change(local.current);
    local.current = next; generation.current += 1;
    setDraft(next); setPending(true);
  }, []);

  const updateForm = useCallback((key: string, field: string, value: FormInputs[string][string]) => {
    update((current) => ({ ...current, formInputs: { ...current.formInputs,
      [key]: { ...current.formInputs[key], [field]: value } } }));
  }, [update]);

  const updateEvent = useCallback((event: EventFile, migrationRequiresReview?: boolean) => {
    update((current) => ({ ...current, event, dirty: true,
      migrationRequiresReview: migrationRequiresReview ?? current.migrationRequiresReview }));
  }, [update]);

  useEffect(() => {
    if (!pending || saving || error || state?.readOnly) return;
    const timer = setTimeout(() => { void flush().catch(() => undefined); }, 350);
    return () => clearTimeout(timer);
  }, [pending, saving, draft, error, flush, state?.readOnly]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (generation.current !== savedGeneration.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  const refresh = useCallback(async () => {
    if (!client.current) return;
    const next = await client.current.request<OperatorState>('/state');
    install(next);
  }, [install]);

  const initialized = state !== null;
  useEffect(() => {
    if (!initialized) return;
    const timer = setInterval(() => { void refresh().catch(() => undefined); }, 5000);
    return () => clearInterval(timer);
  }, [initialized, refresh]);

  const takeover = useCallback(async () => {
    if (!client.current) return;
    const next = await client.current.session(true);
    // Existing unsaved inputs in this window survive a lease change.
    install(next); setError(null);
  }, [install]);

  const reload = useCallback(async () => {
    if (!client.current) { window.location.reload(); return; }
    const next = await client.current.request<OperatorState>('/state');
    install(next, true); setError(null);
  }, [install]);

  return { state, draft, error, saving, pending, client, flush, updateEvent, updateForm, update, refresh, reload, takeover };
}
