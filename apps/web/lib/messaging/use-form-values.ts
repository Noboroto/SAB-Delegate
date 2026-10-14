'use client';

import { Form, type FormInstance } from 'antd';

/**
 * What is typed in the form right now. AntD reports nothing until the first
 * effect has run, so the first render gets an empty object rather than `undefined`.
 */
export function useFormValues<T extends object>(form: FormInstance<T>): Partial<T> {
  const watched: Partial<T> | undefined = Form.useWatch<Partial<T>>([], form);
  return watched ?? {};
}
