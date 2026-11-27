import { RULE_COPY, STATUS, categoryLabel, formatDate, formatDateTime, formatMoney, humanize, ruleShort } from '../api.js';
import { OutcomeBadge } from './ui.jsx';

const ACTION_LABEL = {
  create: 'Claim created', created: 'Claim created', edit: 'Edited', update: 'Edited', submit: 'Submitted', submitted: 'Submitted',
  approve: 'Approved', approved: 'Approved', reject: 'Rejected', rejected: 'Rejected', send_back: 'Sent back for clarification',
  clear: 'Cleared in sample audit', auto_reject: 'Blocked by policy', auto_approve: 'Auto-approved', sample_audit: 'Picked for sample audit',
  add_to_batch: 'Added to payout batch', batch_created: 'Added to payout batch', mark_paid: 'Paid', paid: 'Paid',
  head_step_skipped_self: 'Finance head step skipped (claimant is the only head)', policy_update: 'Policy updated',
};

export function reasonText(r) {
  if (!r) return '';
  if (typeof r === 'string') return RULE_COPY[r]?.text || humanize(r);
  return r.message || RULE_COPY[r.code]?.text || humanize(r.code);
}

function ReasonIcon({ outcome }) {
  const map = { REJECT: ['⛔', 'Blocks the claim'], ROUTE: ['⚠️', 'Needs a reviewer'], APPROVE: ['✓', 'OK'] };
  const [icon, label] = map[outcome] || ['•', ''];
  return <span aria-label={label} role="img">{icon}</span>;
}

export function LineSummary({ line, index }) {
  return (
    <>
      <div className="line-top">
        <span className="cell-strong">{index + 1}. {categoryLabel(line.category)} · {line.vendor || '—'}</span>
        <span className="cell-strong num">{formatMoney(line.amount_paise)}</span>
      </div>
      <div className="row small muted" style={{ marginTop: 4 }}>
        <span>{formatDate(line.expense_date)}</span>
        {line.category === 'hotel' && <span>· {line.city || '—'}, {line.nights || '?'} night{Number(line.nights) === 1 ? '' : 's'}</span>}
        <span>· {line.receipt_id ? '📎 Receipt' : 'No receipt'}</span>
        <OutcomeBadge outcome={line.outcome} />
      </div>
      {line.description && <p className="small" style={{ margin: '4px 0 0' }}>{line.description}</p>}
      {Array.isArray(line.reasons) && line.reasons.length > 0 && (
        <ul className="reasons" aria-label="Policy checks">
          {line.reasons.map((r, i) => (
            <li key={`${r.code || r}-${i}`}>
              <ReasonIcon outcome={r.outcome} />
              <span><strong>{ruleShort(r.code || r)}:</strong> {reasonText(r)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function Timeline({ entries }) {
  if (!entries?.length) return <p className="muted">No activity recorded yet.</p>;
  return (
    <ol className="timeline">
      {entries.map((e, i) => {
        const action = e.action || e.event || e.type;
        const to = e.to_status || e.new_status;
        const label = ACTION_LABEL[action] || humanize(action) || (to ? STATUS[to]?.label : 'Update');
        const actor = e.actor_name || e.actor?.name || (e.actor_id ? `User #${e.actor_id}` : 'System');
        const behalf = e.on_behalf_of_name || e.on_behalf_of?.name || (e.on_behalf_of_id ? `user #${e.on_behalf_of_id}` : null);
        const comment = e.comment || e.details?.comment || e.payload?.comment;
        return (
          <li key={e.id ?? i}>
            <div className="t-action">{label}{to && STATUS[to] ? <span className="muted small"> → {STATUS[to].label}</span> : null}</div>
            <div className="t-when">
              {actor}{behalf ? ` on behalf of ${behalf}` : ''}{e.step ? ` · ${humanize(e.step)} step` : ''} · <time dateTime={e.created_at || e.at}>{formatDateTime(e.created_at || e.at || e.timestamp)}</time>
            </div>
            {comment && <div className="comment">“{comment}”</div>}
          </li>
        );
      })}
    </ol>
  );
}

export function latestComments(entries) {
  return (entries || []).filter((e) => (e.comment || e.details?.comment) && ['approve', 'reject', 'send_back', 'clear'].includes(e.action));
}
