import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { APP_ROLES, type AppRole } from "@/lib/roles";

interface RoleSelectProps {
  id: string;
  name: string;
  value: AppRole;
}

/**
 * The role `<select>` with its options rendered by React, so `defaultValue` marks the current role `selected` and
 * nothing but `<option>`s sits inside the `<select>` (Astro children would arrive as a static slot wrapper).
 * Stateless: rendered on the server with no hydration directive; the row's `<label for={id}>` names it.
 */
export function RoleSelect({ id, name, value }: RoleSelectProps) {
  return (
    <NativeSelect id={id} name={name} size="sm" defaultValue={value}>
      {APP_ROLES.map((role) => (
        <NativeSelectOption key={role} value={role}>
          {role}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
