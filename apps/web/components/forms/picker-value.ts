/**
 * The value contract the Discord pickers share. It is the `value`/`onChange`
 * pair an AntD `Form.Item` injects, so a picker drops into a form unchanged:
 * one id (or none) by default, a list of ids with `multiple`.
 */
export type PickerValueProps =
  | {
      multiple?: false;
      value?: string | null;
      onChange?: (value: string | undefined) => void;
    }
  | {
      multiple: true;
      value?: readonly string[];
      onChange?: (value: string[]) => void;
    };

interface PickerCommonProps {
  guildId: string;
  disabled?: boolean;
  allowClear?: boolean;
  placeholder?: string;
  /** The id a `Form.Item` label points at. */
  id?: string;
  'aria-label'?: string;
}

export type PickerProps = PickerCommonProps & PickerValueProps;

/** What AntD's `Select` takes for the two modes; the union above cannot be spread into it as is. */
export function selectValueProps(props: PickerValueProps) {
  if (props.multiple === true) {
    return {
      mode: 'multiple' as const,
      value: props.value === undefined ? undefined : [...props.value],
      onChange: (next: string | string[] | undefined) =>
        props.onChange?.(Array.isArray(next) ? next : next === undefined ? [] : [next]),
    };
  }
  return {
    mode: undefined,
    value: props.value ?? undefined,
    onChange: (next: string | string[] | undefined) =>
      props.onChange?.(Array.isArray(next) ? next[0] : next),
  };
}
