import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

interface AssigneeSelectProps {
  id: string;
  name: string;
  /** The shift's current assignee, or null for Uncovered. */
  value: string | null;
  /** Every member, in display order; the labels come from `accountLabel(member).text`. */
  options: { value: string; label: string }[];
}

/**
 * The shift's "Who" `<select>`: Uncovered (value `""`) plus every member, with its options rendered by React so
 * `defaultValue` marks the current assignee `selected` and nothing but `<option>`s sits inside the `<select>` (Astro
 * children would arrive as a static slot wrapper). Stateless: rendered on the server with no hydration directive; the
 * row's `<label for={id}>` names it.
 */
export function AssigneeSelect({ id, name, value, options }: AssigneeSelectProps) {
  return (
    <NativeSelect id={id} name={name} size="sm" defaultValue={value ?? ""} className="max-w-64">
      <NativeSelectOption value="">Uncovered</NativeSelectOption>
      {options.map((option) => (
        <NativeSelectOption key={option.value} value={option.value}>
          {option.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
