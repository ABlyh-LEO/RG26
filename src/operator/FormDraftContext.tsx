import { createContext, useContext, type ReactNode } from 'react';
import type { FormInputs } from './contracts';
export type { FormInputs } from './contracts';
type FormValue = string | number | boolean | null;

const FormDraftContext = createContext<{
  inputs: FormInputs;
  update: (key: string, field: string, value: FormValue) => void;
}>({ inputs: {}, update: () => { throw new Error('缺少草稿表单上下文'); } });

export function FormDraftProvider({ inputs, update, children }: {
  inputs: FormInputs;
  update: (key: string, field: string, value: FormValue) => void;
  children: ReactNode;
}) {
  return <FormDraftContext.Provider value={{ inputs, update }}>{children}</FormDraftContext.Provider>;
}

/** 每场、每局使用不同的 key。值直接来自服务草稿，组件切换不会丢失未完成输入。 */
export function useFormField<T>(key: string, field: string, initial: T): [T, (value: T) => void] {
  const { inputs, update } = useContext(FormDraftContext);
  const entry = inputs[key];
  let value = entry && Object.prototype.hasOwnProperty.call(entry, field) ? entry[field] as T : initial;
  if (Array.isArray(initial)) {
    try {
      const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
      value = Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed as T : initial;
    } catch { value = initial; }
  } else if (initial === null) {
    if (value !== null && typeof value !== 'string') value = initial;
  } else if (typeof value !== typeof initial) {
    value = initial;
  }
  return [value, (next: T) => update(key, field,
    typeof next === 'object' && next !== null ? JSON.stringify(next) : next as FormValue)];
}
