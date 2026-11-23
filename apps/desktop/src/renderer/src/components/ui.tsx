import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-bg font-bold hover:bg-white",
  secondary: "border border-control-line bg-control text-ink-strong font-semibold hover:bg-[#26282d]",
  ghost: "text-soft font-semibold hover:text-white",
};

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[9px] px-4 text-sm disabled:cursor-default disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function Card({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={label} className={`rounded-[14px] border border-line bg-card p-6 ${className}`}>
      {children}
    </section>
  );
}

export function Swatch({ color, label, value }: { color: string | undefined; label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div aria-hidden="true" className="h-[72px] rounded-[10px] border border-[#2e3036]" style={{ background: color ?? "#1e2024" }} />
      <span className="text-xs text-muted">{label}</span>
      <span className="truncate text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

const icon = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export function BulbIcon({ size = 18 }: { size?: number }) {
  return (
    <svg {...icon} width={size} height={size}>
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" />
    </svg>
  );
}

export function HomeIcon() {
  return (
    <svg {...icon}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg {...icon} strokeWidth={2}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}
