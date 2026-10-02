import { useEffect, useRef, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { publicSnapshotSchema, type PublicSnapshot } from '../domain/schema';
import { SnapshotProvider } from '../data/DataProvider';
import { App } from '../app/App';

/** A real iframe viewport exercises the same responsive CSS as spectators' browsers. */
export function PreviewFrame({ snapshot }: { snapshot: PublicSnapshot }) {
  const [width, setWidth] = useState<'mobile' | 'desktop'>('mobile');
  const frame = useRef<HTMLIFrameElement>(null);
  const send = () => frame.current?.contentWindow?.postMessage({ type: 'rg26.local-preview', snapshot }, window.location.origin);
  useEffect(() => {
    const sendCurrent = () => frame.current?.contentWindow?.postMessage({ type: 'rg26.local-preview', snapshot }, window.location.origin);
    const ready = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow && event.origin === window.location.origin && event.data?.type === 'rg26.preview-ready') sendCurrent();
    };
    window.addEventListener('message', ready); sendCurrent();
    return () => window.removeEventListener('message', ready);
  }, [snapshot]);
  return <section className="operator-preview" aria-label="观众视角预览">
    <div className="operator-preview__tools"><strong>本地草稿 · 尚未发布</strong><div className="segmented">
      <button className="segmented__item" type="button" aria-pressed={width === 'mobile'} onClick={() => setWidth('mobile')}>手机 390px</button>
      <button className="segmented__item" type="button" aria-pressed={width === 'desktop'} onClick={() => setWidth('desktop')}>桌面 1200px</button>
    </div></div>
    <div className="operator-preview__canvas"><iframe ref={frame} onLoad={send} title="本地草稿观众预览"
      src="/operator.html?preview=1" className={`operator-preview__frame operator-preview__frame--${width}`} /></div>
  </section>;
}

export function PreviewHost() {
  const [snapshot, setSnapshot] = useState<PublicSnapshot | null>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.type !== 'rg26.local-preview') return;
      const parsed = publicSnapshotSchema.safeParse(event.data.snapshot);
      if (parsed.success) setSnapshot(parsed.data);
    };
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'rg26.preview-ready' }, window.location.origin);
    return () => window.removeEventListener('message', receive);
  }, []);
  if (!snapshot) return <p className="empty">正在装入本地草稿预览…</p>;
  return <SnapshotProvider snapshot={snapshot}><MemoryRouter><div className="operator-preview-label">本地草稿预览 · 尚未发布</div><App /></MemoryRouter></SnapshotProvider>;
}
