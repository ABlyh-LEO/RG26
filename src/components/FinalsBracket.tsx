import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BracketChart, type BracketNodeContent } from './BracketChart';
import { FINALS_ZONES, buildFinalsPresentation, finalsZoneOf, finalsIncoming, finalsOutgoing, type FinalsTransfer } from '../data/finals-presentation';
import { FINALS_NODES } from '../domain/finals';
import type { EventFile } from '../domain/schema';
import '../styles/finals-bracket.css';
const MATCH_LABEL = new Map(FINALS_NODES.filter((node) => node.matchNo !== null).map((node) => [node.id, `第 ${node.matchNo} 场 · ${node.label}`]));
const EXIT_LABEL: Record<string, string> = {
  'F-L1A': '败者结算八强', 'F-L1B': '败者结算八强',
  'F-L2A': '败者结算八强', 'F-L2B': '败者结算八强',
  'F-LSF': '败者结算四强', 'F-QUAL': '败者获得季军',
  'F-GF': '胜者获得冠军 · 败者获得亚军',
};

export interface FinalsBracketProps {
  event: EventFile;
  renderNode: (id: string) => BracketNodeContent;
  highlightedNodeIds?: string[];
}

/** 三个明确分区，跨区关系可定位；不再把落败路线横穿整幅画布。 */
export function FinalsBracket({ event, renderNode, highlightedNodeIds = [] }: FinalsBracketProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const zones = useMemo(() => buildFinalsPresentation(event).zones, [event]);

  useLayoutEffect(() => {
    rootRef.current?.querySelectorAll<HTMLElement>('[data-node-id]').forEach((node) => {
      node.classList.toggle('is-focused', node.dataset.nodeId === focusedId);
    });
  });

  useLayoutEffect(() => {
    if (!focusedId) return;
    const node = rootRef.current?.querySelector<HTMLElement>(`[data-node-id="${focusedId}"]`);
    if (!node) return;
    const scroller = node.closest<HTMLElement>('.bracket__scroller');
    if (scroller) {
      const nodeBox = node.getBoundingClientRect();
      const scrollBox = scroller.getBoundingClientRect();
      scroller.scrollTo({ left: scroller.scrollLeft + nodeBox.left - scrollBox.left - Math.max(0, (scroller.clientWidth - nodeBox.width) / 2), behavior: 'instant' });
    }
    // 只横移所属画布，页面只做纵向定位，避免把页面本体推离视口。
    window.scrollTo({ top: window.scrollY + node.getBoundingClientRect().top - 104, behavior: 'instant' });
    node.querySelector<HTMLElement>('a, button')?.focus({ preventScroll: true });
  }, [focusedId, focusRequest]);

  const locate = (id: string) => {
    setFocusedId(id);
    setFocusRequest((request) => request + 1);
  };

  const transferButton = (transfer: FinalsTransfer, incoming: boolean) => {
    const target = incoming ? transfer.fromId : transfer.toId;
    const outcome = transfer.via === 'winner' ? '胜者' : '败者';
    return (
      <button
        key={`${transfer.fromId}-${transfer.toId}-${incoming ? 'in' : 'out'}`}
        type="button"
        className={`finals-transfer finals-transfer--${transfer.via}`}
        data-from-id={transfer.fromId}
        data-to-id={transfer.toId}
        data-via={transfer.via}
        aria-label={incoming ? `查看来源：第 ${transfer.fromMatchNo} 场${outcome}` : `查看去向：本场${outcome}进入第 ${transfer.toMatchNo} 场`}
        onClick={() => locate(target)}
      >
        <span>{incoming ? `来自第 ${transfer.fromMatchNo} 场${outcome}` : `${outcome} → 第 ${transfer.toMatchNo} 场`}</span>
        <span className="finals-transfer__arrow" aria-hidden="true">{incoming ? '↖' : '↗'}</span>
      </button>
    );
  };

  const footer = (id: string) => {
    const zone = finalsZoneOf(id);
    const incoming = finalsIncoming(event, id).filter((transfer) => finalsZoneOf(transfer.fromId) !== zone);
    const outgoing = finalsOutgoing(event, id);
    const crossZone = outgoing.filter((transfer) => finalsZoneOf(transfer.toId) !== zone);
    const localWinner = outgoing.find((transfer) => transfer.via === 'winner' && finalsZoneOf(transfer.toId) === zone);
    return (
      <div className="finals-node-footer">
        {incoming.map((transfer) => transferButton(transfer, true))}
        {crossZone.map((transfer) => transferButton(transfer, false))}
        {localWinner ? <span className="finals-node-footer__route">胜者沿实线 → 第 {localWinner.toMatchNo} 场</span> : null}
        {EXIT_LABEL[id] ? <span className="finals-node-footer__exit">{EXIT_LABEL[id]}</span> : null}
      </div>
    );
  };

  return (
    <div className="finals-bracket" ref={rootRef}>
      <div className="finals-bracket__intro">
        <p><strong>八强双败 → 冠军争夺</strong><span>第 11 场胜者直通第 14 场总决赛；第 11 场败者与第 12 场胜者争夺另一名额。</span></p>
        <div className="finals-bracket__navigation" role="group" aria-label="定位决赛分区">
          {FINALS_ZONES.map((zone) => <button key={zone.id} className={`btn finals-zone-button finals-zone-button--${zone.id}`} type="button" onClick={() => {
            const section = rootRef.current?.querySelector<HTMLElement>(`[data-bracket-zone="${zone.id}"]`);
            if (!section) return;
            window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top - 90, behavior: 'instant' });
            section.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
          }}>{zone.title}</button>)}
        </div>
        <p className="finals-bracket__hint">按晋级线路排列，场次号对应赛程顺序。实线表示本区晋级；点击来源或去向可定位跨区比赛。手机可左右滑动每个分区。</p>
      </div>
      <p className="visually-hidden" aria-live="polite">{focusedId ? `已定位${MATCH_LABEL.get(focusedId) ?? '关联比赛'}` : ''}</p>
      {zones.map((zone) => (
        <section key={zone.id} className={`finals-zone finals-zone--${zone.id}`} data-bracket-zone={zone.id} aria-label={zone.title}>
          <div className="finals-zone__head">
            <span className="finals-zone__marker" aria-hidden="true">{zone.id === 'winners' ? '01' : zone.id === 'losers' ? '02' : '03'}</span>
            <div><h2 tabIndex={-1}>{zone.title}</h2><p>{zone.description}</p></div>
          </div>
          <BracketChart
            columns={zone.columns}
            connections={zone.connections}
            connectorRouting="tree"
            renderNode={renderNode}
            renderNodeFooter={footer}
            minColumnWidth={260}
            ariaLabel={`${zone.title}对阵图，可横向滚动`}
            highlightedNodeIds={highlightedNodeIds}
            showStageNavigation
          />
        </section>
      ))}
    </div>
  );
}
