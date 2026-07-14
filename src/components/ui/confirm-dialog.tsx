'use client';

import { useCallback, useRef, useState } from 'react';
import { Modal, ModalFooter } from './modal';
import { Button } from './button';

// useConfirm / usePromptDialog — accessible, in-app replacements for window.confirm /
// window.prompt (Tier 0). Native browser dialogs aren't theme-aware or a11y-friendly and block
// the event loop; these return a Promise so call sites read the same as before:
//   const { confirm, dialog } = useConfirm();
//   if (!(await confirm({ title, message, tone: 'danger' }))) return;
//   // render {dialog} somewhere in the component tree
// Labels default to Thai; pass confirmLabel/cancelLabel (via t()) for other locales.

interface ConfirmOpts {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}

export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((next: ConfirmOpts) => {
    setOpts(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((v: boolean) => {
    setOpts(null);
    resolver.current?.(v);
    resolver.current = null;
  }, []);

  const dialog = opts ? (
    <Modal isOpen onClose={() => settle(false)} title={opts.title} size="sm">
      {opts.message && <p className="whitespace-pre-line text-sm text-gray-600 dark:text-gray-300">{opts.message}</p>}
      <ModalFooter>
        <Button variant="ghost" onClick={() => settle(false)}>
          {opts.cancelLabel ?? 'ยกเลิก'}
        </Button>
        <Button variant={opts.tone === 'danger' ? 'danger' : 'primary'} onClick={() => settle(true)}>
          {opts.confirmLabel ?? 'ยืนยัน'}
        </Button>
      </ModalFooter>
    </Modal>
  ) : null;

  return { confirm, dialog };
}

interface PromptOpts {
  title: string;
  message?: string;
  placeholder?: string;
  /** pre-filled value (window.prompt's second argument) */
  initialValue?: string;
  /** 'number' renders a single-line numeric input instead of the multiline textarea */
  inputType?: 'text' | 'number';
  /** block confirm until non-empty (for required reasons) */
  required?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}

export function usePromptDialog() {
  const [opts, setOpts] = useState<PromptOpts | null>(null);
  const [value, setValue] = useState('');
  const resolver = useRef<((v: string | null) => void) | null>(null);

  const prompt = useCallback((next: PromptOpts) => {
    setOpts(next);
    setValue(next.initialValue ?? '');
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((v: string | null) => {
    setOpts(null);
    resolver.current?.(v);
    resolver.current = null;
  }, []);

  const trimmed = value.trim();
  const dialog = opts ? (
    <Modal isOpen onClose={() => settle(null)} title={opts.title} size="sm">
      {opts.message && <p className="mb-2 whitespace-pre-line text-sm text-gray-600 dark:text-gray-300">{opts.message}</p>}
      {opts.inputType === 'number' ? (
        <input
          type="number"
          inputMode="decimal"
          step="any"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // window.prompt submits on Enter — keep that for the single-line numeric variant
            if (e.key === 'Enter' && !(opts.required && !trimmed)) settle(trimmed);
          }}
          placeholder={opts.placeholder}
          className="control w-full"
        />
      ) : (
        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={opts.placeholder}
          rows={3}
          className="control w-full"
        />
      )}
      <ModalFooter>
        <Button variant="ghost" onClick={() => settle(null)}>
          {opts.cancelLabel ?? 'ยกเลิก'}
        </Button>
        <Button disabled={!!opts.required && !trimmed} onClick={() => settle(trimmed)}>
          {opts.confirmLabel ?? 'ยืนยัน'}
        </Button>
      </ModalFooter>
    </Modal>
  ) : null;

  return { prompt, dialog };
}
