// Small inline icons so outcome never depends on color alone.
const base = { viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: "false" };

export const CheckIcon = () => (
  <svg {...base}><circle cx="10" cy="10" r="8.2" /><path d="M6.2 10.3l2.5 2.5 5-5.3" /></svg>
);
export const AlertIcon = () => (
  <svg {...base}><circle cx="10" cy="10" r="8.2" /><path d="M10 5.8v5" /><path d="M10 14.2v.1" /></svg>
);
export const CrossIcon = () => (
  <svg {...base}><circle cx="10" cy="10" r="8.2" /><path d="M7 7l6 6M13 7l-6 6" /></svg>
);

export const OUTCOME = {
  APPROVED: { label: "Approved", cls: "approved", Icon: CheckIcon },
  REVIEW: { label: "Sent to review", cls: "review", Icon: AlertIcon },
  DECLINED: { label: "Declined", cls: "declined", Icon: CrossIcon },
};

export function OutcomeBadge({ decision }) {
  const o = OUTCOME[decision] || OUTCOME.DECLINED;
  return (
    <span className={`badge ${o.cls}`}>
      <o.Icon />
      {o.label}
    </span>
  );
}
