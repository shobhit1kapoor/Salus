export function Loading({ label = "Loading care workspace…" }: { label?: string }) { return <div className="center-state" role="status"><span className="spinner" />{label}</div>; }
export function ErrorMessage({ message }: { message: string }) { return <div className="message error" role="alert">{message}</div>; }
