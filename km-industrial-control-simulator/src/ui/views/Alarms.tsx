import { useState } from 'preact/hooks';
import type { AlarmRecord, AlarmState } from '../../core/alarms';
import { Button, Card, Segmented, StatusPill } from '../components';
import { fmt, fmtClock } from '../format';
import { useRuntime, useSnapshot } from '../hooks';
import { toast } from '../toast';

const STATE_LABEL: Record<AlarmState, string> = {
  normal: 'Normal',
  activeUnacked: 'Active, unacknowledged',
  activeAcked: 'Active, acknowledged',
  rtnUnacked: 'Cleared, unacknowledged',
};

function Priority({ p }: { p: AlarmRecord['priority'] }) {
  return <span class={`prio-chip prio-${p}`}>{p}</span>;
}

export function Alarms() {
  const rt = useRuntime();
  const snap = useSnapshot();
  const c = snap.control;
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const active = c.alarms.filter((a) => a.state !== 'normal').sort((a, b) => ['critical', 'high', 'medium', 'low'].indexOf(a.priority) - ['critical', 'high', 'medium', 'low'].indexOf(b.priority) || (a.activeSince ?? 0) - (b.activeSince ?? 0));
  const history = [...rt.control.alarmHistory].reverse().slice(0, 200);

  return (
    <div class="stack">
      <div class="grid three tiles">
        <div class="tile">
          <span class="tile-label">Active alarms</span>
          <span class="tile-value num">{c.activeAlarmCount}</span>
        </div>
        <div class={`tile ${c.unackedCount > 0 ? 'tile-alert' : ''}`}>
          <span class="tile-label">Unacknowledged</span>
          <span class="tile-value num">{c.unackedCount}</span>
        </div>
        <div class="tile">
          <span class="tile-label">Highest priority</span>
          <span class="tile-value">{c.highestAlarmPriority ?? 'none'}</span>
        </div>
      </div>

      <Card
        title="Alarm summary"
        aside={
          <div class="toolbar">
            <Segmented
              label="View"
              value={tab}
              options={[
                { value: 'active', label: `Active (${active.length})` },
                { value: 'history', label: 'History' },
              ]}
              onChange={setTab}
            />
            <Button onClick={() => rt.act((x) => x.acknowledgeAll())} disabled={c.unackedCount === 0}>
              Acknowledge all
            </Button>
            <Button
              tone="primary"
              onClick={() => {
                const r = rt.act((x) => x.resetInterlocks());
                toast(r.ok ? 'Interlocks reset' : `Reset refused: ${r.blockedBy.join(', ')} still present`, r.ok ? 'info' : 'error');
              }}
            >
              Reset interlocks
            </Button>
          </div>
        }
      >
        {tab === 'active' ? (
          active.length === 0 ? (
            <p class="muted">No active alarms. The process is inside all limits.</p>
          ) : (
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Priority</th>
                    <th>Tag</th>
                    <th>Description</th>
                    <th>Value</th>
                    <th>Since</th>
                    <th>State</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {active.map((a) => (
                    <tr class={a.state === 'activeUnacked' || a.state === 'rtnUnacked' ? 'row-unacked' : ''}>
                      <td><Priority p={a.priority} /></td>
                      <td>{a.tag}</td>
                      <td>{a.description}</td>
                      <td class="num">{a.value === null ? '--' : fmt(a.value, 2)}</td>
                      <td class="num">{a.activeSince === null ? '--' : fmtClock(a.activeSince)}</td>
                      <td>
                        <StatusPill tone={a.state === 'rtnUnacked' ? 'warn' : a.state === 'activeAcked' ? 'idle' : 'alarm'}>{STATE_LABEL[a.state]}</StatusPill>
                      </td>
                      <td>
                        {(a.state === 'activeUnacked' || a.state === 'rtnUnacked') && (
                          <Button tone="quiet" onClick={() => rt.act((x) => x.acknowledgeAlarm(a.id))} aria-label={`Acknowledge ${a.tag} ${a.description}`}>
                            Acknowledge
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : history.length === 0 ? (
          <p class="muted">No alarm events yet.</p>
        ) : (
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Priority</th>
                  <th>Tag</th>
                  <th>Description</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {history.map((e) => (
                  <tr>
                    <td class="num">{fmtClock(e.time)}</td>
                    <td>{e.type === 'ACTIVE' ? 'Raised' : e.type === 'ACK' ? 'Acknowledged' : 'Returned to normal'}</td>
                    <td><Priority p={e.priority} /></td>
                    <td>{e.tag}</td>
                    <td>{e.description}</td>
                    <td class="num">{e.value === null ? '--' : fmt(e.value, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
