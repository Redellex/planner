import { Lock, LogIn, Mail, UserPlus } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { SubmitButton } from "@/components/auth/SubmitButton";

// Fixture wrappers for the /dev/auth-states kitchen sink only: they render the real auth components with plain
// props, because an .astro page cannot pass React nodes (icons, the toggle, the hint) to a React component.
// Rendered without `client:*`, so nothing here is interactive.

interface FieldStateProps {
  id: string;
  label: string;
  kind: "email" | "password";
  value?: string;
  placeholder?: string;
  error?: string;
  /** Hint text under the field (the sign-up password hint); tied to the input as `${id}-hint`. */
  hint?: string;
}

export function FieldState({ id, label, kind, value = "", placeholder, error, hint }: FieldStateProps) {
  return (
    <FormField
      id={id}
      label={label}
      type={kind}
      value={value}
      onChange={() => undefined}
      placeholder={placeholder}
      error={error}
      hint={
        hint ? (
          <p id={`${id}-hint`} className="text-muted-foreground text-xs">
            {hint}
          </p>
        ) : undefined
      }
      icon={kind === "email" ? <Mail className="size-4" /> : <Lock className="size-4" />}
      endContent={kind === "password" ? <PasswordToggle visible={false} onToggle={() => undefined} /> : undefined}
    />
  );
}

interface SubmitStateProps {
  form: "signin" | "signup";
  pending: boolean;
}

export function SubmitState({ form, pending }: SubmitStateProps) {
  return form === "signin" ? (
    <SubmitButton pending={pending} pendingText="Signing in…" icon={<LogIn aria-hidden="true" className="size-4" />}>
      Sign in
    </SubmitButton>
  ) : (
    <SubmitButton
      pending={pending}
      pendingText="Creating account…"
      icon={<UserPlus aria-hidden="true" className="size-4" />}
    >
      Create account
    </SubmitButton>
  );
}
